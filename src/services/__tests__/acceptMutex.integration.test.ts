import {randomUUID} from 'crypto';

import {prisma} from '../../prisma/client';
import {disconnectRedis} from '../../config/redis';
import {requestService} from '../requestService';
import {creatorLockKey, creatorLockService} from '../creatorLockService';

/**
 * DB + Redis-backed integration test for the Creator acceptance mutex (backend Phase 3 / Phase 14
 * gap — see `docs/MASTER_EXECUTION_PLAN.md` Phase 14 item 1, "DB-backed integration tests for the
 * escrow/mutex/GPS flows"). Exercises the real Redis `SET NX` lock via `requestService.accept`,
 * not a mocked lock service, so it actually proves two Creators racing to accept the same
 * `PUBLISHED` request cannot both win.
 */
describe('requestService.accept — Creator mutex (integration)', () => {
  let requesterId: string;
  let creatorAId: string;
  let creatorBId: string;
  const REQUEST_LAT = 12.9716;
  const REQUEST_LNG = 77.5946;

  beforeEach(async () => {
    const suffix = randomUUID();
    const requester = await prisma.user.create({
      data: {
        name: 'Mutex Test Requester',
        username: `mutex-requester-${suffix}`,
        email: `mutex-requester-${suffix}@test.local`,
        password: 'hashed',
        walletBalance: 1000,
      },
    });
    const creatorA = await prisma.user.create({
      data: {
        name: 'Mutex Test Creator A',
        username: `mutex-creator-a-${suffix}`,
        email: `mutex-creator-a-${suffix}@test.local`,
        password: 'hashed',
        availabilityStatus: 'ONLINE',
      },
    });
    const creatorB = await prisma.user.create({
      data: {
        name: 'Mutex Test Creator B',
        username: `mutex-creator-b-${suffix}`,
        email: `mutex-creator-b-${suffix}@test.local`,
        password: 'hashed',
        availabilityStatus: 'ONLINE',
      },
    });
    requesterId = requester.id;
    creatorAId = creatorA.id;
    creatorBId = creatorB.id;
  });

  afterEach(async () => {
    const userIds = [requesterId, creatorAId, creatorBId];
    await prisma.notification.deleteMany({where: {userId: {in: userIds}}});
    await prisma.request.deleteMany({where: {requesterId}});
    await prisma.user.deleteMany({where: {id: {in: userIds}}});
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('lets exactly one Creator win when two accept the same request concurrently', async () => {
    const request = await prisma.request.create({
      data: {
        requesterId,
        latitude: REQUEST_LAT,
        longitude: REQUEST_LNG,
        locationCategory: 'PUBLIC',
        description: 'Integration test request for the mutex race',
        durationMinutes: 5,
        rewardAmount: 100,
        category: 'OTHER',
        requesterDeclarationAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: 'PUBLISHED',
      },
    });

    const location = {latitude: REQUEST_LAT, longitude: REQUEST_LNG};
    const results = await Promise.allSettled([
      requestService.accept(creatorAId, request.id, location),
      requestService.accept(creatorBId, request.id, location),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      statusCode: 409,
      message: 'This request has already been accepted by another creator.',
    });

    const finalRequest = await prisma.request.findUniqueOrThrow({where: {id: request.id}});
    expect(finalRequest.status).toBe('TEMPORARY_CHAT');
    expect([creatorAId, creatorBId]).toContain(finalRequest.creatorId);

    // The Redis lock must still be held by the winner (not left dangling/released) so a late
    // retry from the loser doesn't somehow slip through.
    expect(await creatorLockService.isLocked(creatorLockKey(request.id))).toBe(true);
  });

  it('rejects a Creator outside the request radius before ever touching the lock', async () => {
    const request = await prisma.request.create({
      data: {
        requesterId,
        latitude: REQUEST_LAT,
        longitude: REQUEST_LNG,
        locationCategory: 'PUBLIC',
        description: 'Integration test request for the GPS distance gate',
        durationMinutes: 5,
        rewardAmount: 100,
        category: 'OTHER',
        requesterDeclarationAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: 'PUBLISHED',
        radiusMeters: 500,
      },
    });

    // ~5.5km north of the request pin — well outside the 500m radius.
    const farAwayLocation = {latitude: REQUEST_LAT + 0.05, longitude: REQUEST_LNG};

    await expect(requestService.accept(creatorAId, request.id, farAwayLocation)).rejects.toMatchObject({
      statusCode: 403,
      message: 'You must be within 500 metres of the requested location to fulfil this request.',
    });

    const finalRequest = await prisma.request.findUniqueOrThrow({where: {id: request.id}});
    expect(finalRequest.status).toBe('PUBLISHED');
    expect(finalRequest.creatorId).toBeNull();
    expect(await creatorLockService.isLocked(creatorLockKey(request.id))).toBe(false);
  });
});
