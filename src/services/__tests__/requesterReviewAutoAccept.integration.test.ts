import {randomUUID} from 'crypto';

import {prisma} from '../../prisma/client';
import {escrowService} from '../escrowService';
import {requesterReviewAutoAcceptJob} from '../requesterReviewAutoAcceptJob';

/**
 * DB-backed integration test for the v2.1 48h Requester Review auto-accept sweep (backend Phase
 * 3 item 5, PRD_TRD_SUMMARY.md §5.8). Verifies the 42h warning fires once, the 48h auto-accept
 * releases escrow and completes the request exactly like a manual Accept would, and neither
 * sweep touches a request that hasn't crossed its threshold yet.
 */
describe('requesterReviewAutoAcceptJob (integration)', () => {
  let requesterId: string;
  let creatorId: string;

  async function createReviewRequest(currency: 'CREDIT' | 'INR', moderatorDecisionAt: Date) {
    const request = await prisma.request.create({
      data: {
        requesterId,
        creatorId,
        latitude: 12.9716,
        longitude: 77.5946,
        locationCategory: 'PUBLIC',
        description: 'Auto-accept test request description',
        durationMinutes: 5,
        rewardAmount: 150,
        category: 'OTHER',
        currencyMode: currency,
        status: 'REQUESTER_REVIEW',
        requesterDeclarationAt: new Date(),
        moderatorDecisionAt,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    await escrowService.reserve(request.id, requesterId, 150, currency);
    return request;
  }

  beforeEach(async () => {
    const suffix = randomUUID();
    const requester = await prisma.user.create({
      data: {
        name: 'Auto-Accept Requester',
        username: `auto-accept-requester-${suffix}`,
        email: `auto-accept-requester-${suffix}@test.local`,
        password: 'hashed',
      },
    });
    const creator = await prisma.user.create({
      data: {
        name: 'Auto-Accept Creator',
        username: `auto-accept-creator-${suffix}`,
        email: `auto-accept-creator-${suffix}@test.local`,
        password: 'hashed',
      },
    });
    requesterId = requester.id;
    creatorId = creator.id;
    await prisma.user.update({where: {id: requesterId}, data: {bonusCredits: 300}});
  });

  afterEach(async () => {
    await prisma.notification.deleteMany({where: {userId: {in: [requesterId, creatorId]}}});
    await prisma.ledgerEntry.deleteMany({where: {userId: {in: [requesterId, creatorId]}}});
    await prisma.verifiedCreatorStatus.deleteMany({where: {userId: {in: [requesterId, creatorId]}}});
    await prisma.requestEscrow.deleteMany({where: {request: {requesterId}}});
    await prisma.request.deleteMany({where: {requesterId}});
    await prisma.user.deleteMany({where: {id: {in: [requesterId, creatorId]}}});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('does not touch a request still inside the 42h/48h windows', async () => {
    await createReviewRequest('CREDIT', new Date(Date.now() - 10 * 60 * 60 * 1000)); // 10h ago

    const result = await requesterReviewAutoAcceptJob.runSweep();

    expect(result.warned).toBe(0);
    expect(result.accepted).toBe(0);
  });

  it('sends exactly one 42h warning and does not re-send on a second sweep', async () => {
    const request = await createReviewRequest('CREDIT', new Date(Date.now() - 43 * 60 * 60 * 1000)); // 43h ago

    const first = await requesterReviewAutoAcceptJob.runWarningSweep();
    const second = await requesterReviewAutoAcceptJob.runWarningSweep();

    expect(first).toBe(1);
    expect(second).toBe(0);

    const updated = await prisma.request.findUniqueOrThrow({where: {id: request.id}});
    expect(updated.autoAcceptWarningSentAt).not.toBeNull();
  });

  it('auto-accepts at 48h: releases escrow and completes the request', async () => {
    const request = await createReviewRequest('CREDIT', new Date(Date.now() - 49 * 60 * 60 * 1000)); // 49h ago

    const accepted = await requesterReviewAutoAcceptJob.runAutoAcceptSweep();
    expect(accepted).toBe(1);

    const updated = await prisma.request.findUniqueOrThrow({where: {id: request.id}});
    expect(updated.status).toBe('COMPLETED');

    const escrow = await prisma.requestEscrow.findUniqueOrThrow({where: {requestId: request.id}});
    expect(escrow.state).toBe('RELEASED');
  });
});
