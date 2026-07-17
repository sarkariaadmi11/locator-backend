import {randomUUID} from 'crypto';

import {prisma} from '../../prisma/client';
import {moderationService} from '../moderationService';
import {seedAdmins} from '../../utils/seedAdmins';

/**
 * DB-backed integration test for Admin/Moderator "Escalate to Dispute Center" (backend Phase 5
 * item 6, admin frontend Phase 3) — a video under moderation is escalated straight into the
 * Dispute Center instead of being approved/rejected, freezing escrow and opening a Dispute row
 * attributed to the request's Requester with `raisedByRole: 'ADMIN'`.
 */
describe('moderationService.escalate (integration)', () => {
  let adminId: string;
  let requesterId: string;
  let creatorId: string;
  let requestId: string;
  let videoId: string;

  beforeEach(async () => {
    await seedAdmins();
    const admin = await prisma.admin.findFirstOrThrow();
    adminId = admin.id;

    const suffix = randomUUID();
    const requester = await prisma.user.create({
      data: {
        name: 'Escalate Requester',
        username: `escalate-requester-${suffix}`,
        email: `escalate-requester-${suffix}@test.local`,
        password: 'hashed',
      },
    });
    const creator = await prisma.user.create({
      data: {
        name: 'Escalate Creator',
        username: `escalate-creator-${suffix}`,
        email: `escalate-creator-${suffix}@test.local`,
        password: 'hashed',
      },
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
        description: 'Escalate-to-dispute integration test request',
        durationMinutes: 5,
        rewardAmount: 150,
        category: 'OTHER',
        currencyMode: 'CREDIT',
        status: 'MODERATOR_REVIEW',
        requesterDeclarationAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    requestId = request.id;

    await prisma.requestEscrow.create({
      data: {
        requestId,
        amountLocked: 150,
        commissionRate: 0,
        commissionAmount: 0,
        creatorEarnings: 150,
        currency: 'CREDIT',
        state: 'RESERVED',
      },
    });

    const video = await prisma.requestVideo.create({
      data: {
        requestId,
        creatorId,
        status: 'UPLOADED',
        moderationStatus: 'PENDING',
      },
    });
    videoId = video.id;
  });

  afterEach(async () => {
    const ids = [requesterId, creatorId];
    await prisma.notification.deleteMany({where: {userId: {in: ids}}});
    await prisma.dispute.deleteMany({where: {requestId}});
    await prisma.requestVideo.deleteMany({where: {requestId}});
    await prisma.requestEscrow.deleteMany({where: {requestId}});
    await prisma.request.deleteMany({where: {id: requestId}});
    await prisma.user.deleteMany({where: {id: {in: ids}}});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('escalates a video under moderation into a Dispute Center case, freezing escrow', async () => {
    const dispute = await moderationService.escalate(
      adminId,
      videoId,
      'INAPPROPRIATE_CONTENT',
      'Escalated for Admin review — content appears to violate policy.',
    );

    expect(dispute.raisedByRole).toBe('ADMIN');
    expect(dispute.status).toBe('OPEN');

    const requestAfter = await prisma.request.findUniqueOrThrow({where: {id: requestId}});
    expect(requestAfter.status).toBe('DISPUTED');

    const escrowAfter = await prisma.requestEscrow.findUniqueOrThrow({where: {requestId}});
    expect(escrowAfter.state).toBe('FROZEN');
  });
});
