import {randomUUID} from 'crypto';

import {prisma} from '../../prisma/client';
import {escrowService} from '../escrowService';

/**
 * DB-backed integration test for the escrow lifecycle (backend Phase 8 / Phase 14 gap —
 * previously only pure-function unit tests existed, see `docs/MASTER_EXECUTION_PLAN.md` Phase 14
 * item 1). Runs against a real Postgres database (`DATABASE_URL`) and exercises
 * `escrowService.reserve/release/refund` end-to-end, including the money movement into/out of
 * `User.walletBalance` and the `Transaction` ledger rows — not just the escrow row's state field.
 */
describe('escrowService (integration)', () => {
  let requesterId: string;
  let creatorId: string;

  beforeEach(async () => {
    const suffix = randomUUID();
    const requester = await prisma.user.create({
      data: {
        name: 'Escrow Test Requester',
        username: `escrow-requester-${suffix}`,
        email: `escrow-requester-${suffix}@test.local`,
        password: 'hashed',
        walletBalance: 1000,
      },
    });
    const creator = await prisma.user.create({
      data: {
        name: 'Escrow Test Creator',
        username: `escrow-creator-${suffix}`,
        email: `escrow-creator-${suffix}@test.local`,
        password: 'hashed',
        walletBalance: 0,
      },
    });
    requesterId = requester.id;
    creatorId = creator.id;
  });

  afterEach(async () => {
    await prisma.notification.deleteMany({where: {userId: {in: [requesterId, creatorId]}}});
    await prisma.transaction.deleteMany({where: {userId: {in: [requesterId, creatorId]}}});
    await prisma.requestEscrow.deleteMany({where: {request: {requesterId}}});
    await prisma.request.deleteMany({where: {requesterId}});
    await prisma.user.deleteMany({where: {id: {in: [requesterId, creatorId]}}});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createRequest(rewardAmount: number) {
    return prisma.request.create({
      data: {
        requesterId,
        latitude: 12.9716,
        longitude: 77.5946,
        locationCategory: 'PUBLIC',
        description: 'Integration test request description text',
        durationMinutes: 5,
        rewardAmount,
        category: 'OTHER',
        requesterDeclarationAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  it('reserve() debits the requester wallet and creates a RESERVED escrow row', async () => {
    const request = await createRequest(200);

    const escrow = await escrowService.reserve(request.id, requesterId, 200);

    expect(escrow.state).toBe('RESERVED');
    expect(Number(escrow.amountLocked)).toBe(200);

    const requesterAfter = await prisma.user.findUniqueOrThrow({where: {id: requesterId}});
    expect(Number(requesterAfter.walletBalance)).toBe(800);

    const debit = await prisma.transaction.findFirst({where: {userId: requesterId, requestId: request.id}});
    expect(debit?.type).toBe('DEBIT');
    expect(Number(debit?.amount)).toBe(200);
  });

  it('release() credits the creator wallet minus commission and settles the escrow', async () => {
    const request = await createRequest(200);
    await escrowService.reserve(request.id, requesterId, 200);
    await prisma.request.update({where: {id: request.id}, data: {creatorId}});

    const escrow = await escrowService.release(request.id);

    expect(escrow.state).toBe('RELEASED');
    const creatorAfter = await prisma.user.findUniqueOrThrow({where: {id: creatorId}});
    expect(Number(creatorAfter.walletBalance)).toBe(Number(escrow.creatorEarnings));
    expect(Number(escrow.creatorEarnings)).toBeLessThan(200);
    expect(Number(escrow.creatorEarnings) + Number(escrow.commissionAmount)).toBeCloseTo(200, 2);

    // Releasing an already-settled escrow must 409, never double-pay the Creator.
    await expect(escrowService.release(request.id)).rejects.toMatchObject({statusCode: 409});
    const creatorAfterSecondAttempt = await prisma.user.findUniqueOrThrow({where: {id: creatorId}});
    expect(Number(creatorAfterSecondAttempt.walletBalance)).toBe(Number(creatorAfter.walletBalance));
  });

  it('refund() restores the full locked amount to the requester wallet', async () => {
    const request = await createRequest(150);
    await escrowService.reserve(request.id, requesterId, 150);

    const escrow = await escrowService.refund(request.id);

    expect(escrow.state).toBe('REFUNDED');
    const requesterAfter = await prisma.user.findUniqueOrThrow({where: {id: requesterId}});
    // Started at 1000, debited 150 on reserve, refunded 150 back.
    expect(Number(requesterAfter.walletBalance)).toBe(1000);

    // A second refund attempt on an already-settled escrow must 409, never double-refund.
    await expect(escrowService.refund(request.id)).rejects.toMatchObject({statusCode: 409});
    const requesterAfterSecondAttempt = await prisma.user.findUniqueOrThrow({where: {id: requesterId}});
    expect(Number(requesterAfterSecondAttempt.walletBalance)).toBe(1000);
  });
});
