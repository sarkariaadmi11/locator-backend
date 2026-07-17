import {randomUUID} from 'crypto';

import {prisma} from '../../prisma/client';
import {ratingService} from '../ratingService';

/**
 * DB-backed integration test for the double-blind rating reveal (backend Phase 8 item 7,
 * PRD_TRD_SUMMARY.md §4.11) — a rating becomes visible at the later of "both sides submitted"
 * or 7 days after submission. Verifies: a lone rating stays hidden from the other party (but
 * visible to its own author), submitting the second rating reveals both immediately.
 */
describe('ratingService — double-blind reveal (integration)', () => {
  let requesterId: string;
  let creatorId: string;
  let requestId: string;

  beforeEach(async () => {
    const suffix = randomUUID();
    const requester = await prisma.user.create({
      data: {name: 'DB Requester', username: `db-requester-${suffix}`, email: `db-requester-${suffix}@test.local`, password: 'hashed'},
    });
    const creator = await prisma.user.create({
      data: {name: 'DB Creator', username: `db-creator-${suffix}`, email: `db-creator-${suffix}@test.local`, password: 'hashed'},
    });
    requesterId = requester.id;
    creatorId = creator.id;

    const request = await prisma.request.create({
      data: {
        requesterId,
        creatorId,
        latitude: 12.9716,
        longitude: 77.5946,
        locationCategory: 'PUBLIC',
        description: 'Double-blind rating test request',
        durationMinutes: 5,
        rewardAmount: 150,
        category: 'OTHER',
        status: 'COMPLETED',
        requesterDeclarationAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    requestId = request.id;
  });

  afterEach(async () => {
    await prisma.notification.deleteMany({where: {userId: {in: [requesterId, creatorId]}}});
    await prisma.verifiedCreatorStatus.deleteMany({where: {userId: {in: [requesterId, creatorId]}}});
    await prisma.rating.deleteMany({where: {requestId}});
    await prisma.request.deleteMany({where: {id: requestId}});
    await prisma.user.deleteMany({where: {id: {in: [requesterId, creatorId]}}});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a lone rating is visible to its author but hidden from the other party', async () => {
    await ratingService.rate(requesterId, requestId, 5, 'Great job');

    const requesterView = await ratingService.getForRequest(requesterId, requestId);
    expect(requesterView).toHaveLength(1); // sees their own submission

    const creatorView = await ratingService.getForRequest(creatorId, requestId);
    expect(creatorView).toHaveLength(0); // the other party doesn't see it yet
  });

  it('submitting the second rating reveals both immediately', async () => {
    await ratingService.rate(requesterId, requestId, 5, 'Great job');
    await ratingService.rate(creatorId, requestId, 4, 'Good requester');

    const requesterView = await ratingService.getForRequest(requesterId, requestId);
    const creatorView = await ratingService.getForRequest(creatorId, requestId);

    expect(requesterView).toHaveLength(2);
    expect(creatorView).toHaveLength(2);
  });

  it('a rating older than 7 days becomes visible even without the other side submitting', async () => {
    const rating = await ratingService.rate(requesterId, requestId, 5, 'Great job');
    // Simulate the 7-day window having already elapsed.
    await prisma.rating.update({where: {id: rating.id}, data: {visibleAt: new Date(Date.now() - 1000)}});

    const creatorView = await ratingService.getForRequest(creatorId, requestId);
    expect(creatorView).toHaveLength(1);
  });
});
