import {randomUUID} from 'crypto';

import {prisma} from '../../prisma/client';
import {ledgerService} from '../ledgerService';
import {tipService} from '../tipService';

/**
 * DB-backed integration test for Tipping (PRD_TRD_SUMMARY.md §3.3, §4.13, backend Phase 2 item
 * 6). Covers both the CREDIT-mode branch (via `ledgerService`) and the INR-mode branch (via the
 * existing `walletBalance`/`Transaction` pattern) — INR is the only branch reachable through
 * today's actual request-creation flow (Phase 2 item 5, currency-aware escrow, hasn't landed
 * yet), but both are exercised directly here since `tipService` branches on `currencyMode`.
 */
describe('tipService (integration)', () => {
  let requesterId: string;
  let creatorId: string;

  async function createCompletedRequest(currencyMode: 'CREDIT' | 'INR') {
    return prisma.request.create({
      data: {
        requesterId,
        creatorId,
        latitude: 12.9716,
        longitude: 77.5946,
        locationCategory: 'PUBLIC',
        description: 'Tip test request description text',
        durationMinutes: 5,
        rewardAmount: 150,
        category: 'OTHER',
        currencyMode,
        status: 'COMPLETED',
        requesterDeclarationAt: new Date(),
        requesterDecisionAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  beforeEach(async () => {
    const suffix = randomUUID();
    const requester = await prisma.user.create({
      data: {
        name: 'Tip Test Requester',
        username: `tip-requester-${suffix}`,
        email: `tip-requester-${suffix}@test.local`,
        password: 'hashed',
        walletBalance: 1000,
      },
    });
    const creator = await prisma.user.create({
      data: {
        name: 'Tip Test Creator',
        username: `tip-creator-${suffix}`,
        email: `tip-creator-${suffix}@test.local`,
        password: 'hashed',
      },
    });
    requesterId = requester.id;
    creatorId = creator.id;
  });

  afterEach(async () => {
    await prisma.notification.deleteMany({where: {userId: {in: [requesterId, creatorId]}}});
    await prisma.tip.deleteMany({where: {fromUserId: requesterId}});
    await prisma.ledgerEntry.deleteMany({where: {userId: {in: [requesterId, creatorId]}}});
    await prisma.transaction.deleteMany({where: {userId: {in: [requesterId, creatorId]}}});
    await prisma.request.deleteMany({where: {requesterId}});
    await prisma.user.deleteMany({where: {id: {in: [requesterId, creatorId]}}});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('INR mode: moves money wallet-to-wallet with zero commission', async () => {
    const request = await createCompletedRequest('INR');

    await tipService.tip(requesterId, request.id, 50);

    const requester = await prisma.user.findUniqueOrThrow({where: {id: requesterId}});
    const creator = await prisma.user.findUniqueOrThrow({where: {id: creatorId}});
    expect(Number(requester.walletBalance)).toBe(950);
    expect(Number(creator.walletBalance)).toBe(50); // full amount, no commission deducted
  });

  it('CREDIT mode: debits Requester Credits and credits Creator via ledgerService', async () => {
    const request = await createCompletedRequest('CREDIT');
    await ledgerService.creditCredits(requesterId, 100, 'earned', 'CREATOR_REWARD');

    await tipService.tip(requesterId, request.id, 40);

    const balances = await ledgerService.getBalances(requesterId);
    const creatorBalances = await ledgerService.getBalances(creatorId);
    expect(balances.videoCredits).toBe(60);
    expect(creatorBalances.videoCredits).toBe(40);
  });

  it('rejects a second tip on the same request', async () => {
    const request = await createCompletedRequest('INR');
    await tipService.tip(requesterId, request.id, 20);

    await expect(tipService.tip(requesterId, request.id, 20)).rejects.toMatchObject({statusCode: 409});
  });

  it('rejects tipping on a request that is not yet Completed', async () => {
    const request = await prisma.request.create({
      data: {
        requesterId,
        creatorId,
        latitude: 12.9716,
        longitude: 77.5946,
        locationCategory: 'PUBLIC',
        description: 'Not completed yet',
        durationMinutes: 5,
        rewardAmount: 150,
        category: 'OTHER',
        status: 'PUBLISHED',
        requesterDeclarationAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await expect(tipService.tip(requesterId, request.id, 20)).rejects.toMatchObject({statusCode: 409});
  });

  it('rejects a tip from anyone other than the Requester', async () => {
    const request = await createCompletedRequest('INR');
    await expect(tipService.tip(creatorId, request.id, 20)).rejects.toMatchObject({statusCode: 403});
  });
});
