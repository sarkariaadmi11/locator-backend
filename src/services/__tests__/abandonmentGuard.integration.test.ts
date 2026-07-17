import {randomUUID} from 'crypto';

import {prisma} from '../../prisma/client';
import {acceptanceTimerJob} from '../acceptanceTimerJob';
import {requestService} from '../requestService';

/**
 * DB-backed integration test for the abandonment guard (backend Phase 8 item 3,
 * PRD_TRD_SUMMARY.md §5.8 `abandonment_guard_evaluation`) — 3 acceptance-timer expiries in a
 * rolling 30 days blocks new Accepts for 24h. Exercises `acceptanceTimerJob.runSweep()` directly
 * (not through the Redis mutex, which isn't available in this environment) against rows already
 * sitting in the expired-CREATOR_ASSIGNED state it queries for.
 */
describe('abandonment guard (integration)', () => {
  let requesterId: string;
  let creatorId: string;

  beforeEach(async () => {
    const suffix = randomUUID();
    const requester = await prisma.user.create({
      data: {name: 'Abandon Requester', username: `abandon-requester-${suffix}`, email: `abandon-requester-${suffix}@test.local`, password: 'hashed'},
    });
    const creator = await prisma.user.create({
      data: {name: 'Abandon Creator', username: `abandon-creator-${suffix}`, email: `abandon-creator-${suffix}@test.local`, password: 'hashed', availabilityStatus: 'ONLINE'},
    });
    requesterId = requester.id;
    creatorId = creator.id;
  });

  afterEach(async () => {
    await prisma.notification.deleteMany({where: {userId: {in: [requesterId, creatorId]}}});
    await prisma.abandonmentEvent.deleteMany({where: {creatorId}});
    await prisma.request.deleteMany({where: {requesterId}});
    await prisma.user.deleteMany({where: {id: {in: [requesterId, creatorId]}}});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createExpiredAcceptance() {
    return prisma.request.create({
      data: {
        requesterId,
        creatorId,
        lastAssignedCreatorId: creatorId,
        latitude: 12.9716,
        longitude: 77.5946,
        locationCategory: 'PUBLIC',
        description: 'Abandonment guard test request',
        durationMinutes: 5,
        rewardAmount: 150,
        category: 'OTHER',
        status: 'CREATOR_ASSIGNED',
        requesterDeclarationAt: new Date(),
        acceptedAt: new Date(Date.now() - 20 * 60 * 1000),
        acceptanceTimerExpiresAt: new Date(Date.now() - 5 * 60 * 1000), // already expired
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  it('does not block after fewer than 3 abandonments', async () => {
    await createExpiredAcceptance();
    await acceptanceTimerJob.runSweep();

    const user = await prisma.user.findUniqueOrThrow({where: {id: creatorId}});
    expect(user.acceptanceBlockedUntil).toBeNull();

    const events = await prisma.abandonmentEvent.count({where: {creatorId}});
    expect(events).toBe(1);
  });

  it('blocks Accept for 24h on the 3rd abandonment within 30 days', async () => {
    // Two prior abandonments already on record (simulating earlier sweeps).
    await prisma.abandonmentEvent.createMany({
      data: [
        {creatorId, requestId: randomUUID()},
        {creatorId, requestId: randomUUID()},
      ],
    });

    const request = await createExpiredAcceptance();
    await acceptanceTimerJob.runSweep();

    const user = await prisma.user.findUniqueOrThrow({where: {id: creatorId}});
    expect(user.acceptanceBlockedUntil).not.toBeNull();
    expect(user.acceptanceBlockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // A fresh request the creator now tries to accept is rejected while blocked.
    const freshRequest = await prisma.request.create({
      data: {
        requesterId,
        latitude: 12.9716,
        longitude: 77.5946,
        locationCategory: 'PUBLIC',
        description: 'Fresh request while blocked',
        durationMinutes: 5,
        rewardAmount: 150,
        category: 'OTHER',
        status: 'PUBLISHED',
        requesterDeclarationAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await expect(
      requestService.accept(creatorId, freshRequest.id, {latitude: 12.9716, longitude: 77.5946}),
    ).rejects.toMatchObject({statusCode: 403});

    await prisma.request.deleteMany({where: {id: {in: [request.id, freshRequest.id]}}});
  });
});
