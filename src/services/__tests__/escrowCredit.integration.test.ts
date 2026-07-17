import {randomUUID} from 'crypto';

import {BETA_ECONOMY_DEFAULTS} from '../../config/betaEconomy';
import {prisma} from '../../prisma/client';
import {escrowService} from '../escrowService';
import {ledgerService} from '../ledgerService';

/**
 * DB-backed integration test for the CREDIT-mode branch of `escrowService` (backend Phase 2
 * item 5, PRD_TRD_SUMMARY.md §4.5). Mirrors `escrow.integration.test.ts`'s INR-mode coverage —
 * this file exercises the same reserve/release/refund lifecycle but through the Beta Credits
 * ledger instead of `walletBalance`, confirming `RequestEscrow.currency` correctly routes each
 * call to `ledgerService` with zero commission and the independently-configured Creator Reward.
 */
describe('escrowService — CREDIT mode (integration)', () => {
  let requesterId: string;
  let creatorId: string;

  beforeEach(async () => {
    const suffix = randomUUID();
    const requester = await prisma.user.create({
      data: {
        name: 'Credit Escrow Requester',
        username: `credit-escrow-requester-${suffix}`,
        email: `credit-escrow-requester-${suffix}@test.local`,
        password: 'hashed',
      },
    });
    const creator = await prisma.user.create({
      data: {
        name: 'Credit Escrow Creator',
        username: `credit-escrow-creator-${suffix}`,
        email: `credit-escrow-creator-${suffix}@test.local`,
        password: 'hashed',
      },
    });
    requesterId = requester.id;
    creatorId = creator.id;
    await ledgerService.creditCredits(requesterId, 300, 'bonus', 'SIGNUP_BONUS');
  });

  afterEach(async () => {
    await prisma.notification.deleteMany({where: {userId: {in: [requesterId, creatorId]}}});
    await prisma.ledgerEntry.deleteMany({where: {userId: {in: [requesterId, creatorId]}}});
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
        description: 'Credit escrow integration test request',
        durationMinutes: 5,
        rewardAmount,
        category: 'OTHER',
        currencyMode: 'CREDIT',
        requesterDeclarationAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  it('reserve() debits Credits (not walletBalance) and creates a CREDIT RESERVED escrow row', async () => {
    const request = await createRequest(150);

    const escrow = await escrowService.reserve(request.id, requesterId, 150, 'CREDIT');

    expect(escrow.currency).toBe('CREDIT');
    expect(escrow.state).toBe('RESERVED');
    expect(Number(escrow.commissionAmount)).toBe(0); // zero commission in Beta mode

    const balances = await ledgerService.getBalances(requesterId);
    expect(balances.videoCredits).toBe(150); // 300 - 150

    const requesterAfter = await prisma.user.findUniqueOrThrow({where: {id: requesterId}});
    expect(Number(requesterAfter.walletBalance)).toBe(0); // untouched, not decremented
  });

  it('release() credits the Creator Reward in full (no commission split) via ledgerService', async () => {
    const request = await createRequest(150);
    await escrowService.reserve(request.id, requesterId, 150, 'CREDIT');
    await prisma.request.update({where: {id: request.id}, data: {creatorId}});

    const escrow = await escrowService.release(request.id);

    expect(escrow.state).toBe('RELEASED');
    expect(Number(escrow.creatorEarnings)).toBe(BETA_ECONOMY_DEFAULTS.CREATOR_REWARD_CREDITS);

    const creatorBalances = await ledgerService.getBalances(creatorId);
    expect(creatorBalances.videoCredits).toBe(BETA_ECONOMY_DEFAULTS.CREATOR_REWARD_CREDITS);

    const creatorAfter = await prisma.user.findUniqueOrThrow({where: {id: creatorId}});
    expect(Number(creatorAfter.walletBalance)).toBe(0); // untouched — CREDIT mode never touches walletBalance
  });

  it('refund() restores the full locked amount to the Requester\'s bonus Credits bucket', async () => {
    const request = await createRequest(150);
    await escrowService.reserve(request.id, requesterId, 150, 'CREDIT');

    const escrow = await escrowService.refund(request.id);

    expect(escrow.state).toBe('REFUNDED');
    const balances = await ledgerService.getBalances(requesterId);
    expect(balances.videoCredits).toBe(300); // fully restored
  });
});
