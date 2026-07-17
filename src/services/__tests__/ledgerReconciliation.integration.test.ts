import {randomUUID} from 'crypto';

import {prisma} from '../../prisma/client';
import {ledgerReconciliationJob} from '../ledgerReconciliationJob';
import {ledgerService} from '../ledgerService';

/**
 * DB-backed integration test for the nightly ledger reconciliation job (backend Phase 8 item 4,
 * PRD_TRD_SUMMARY.md §5.8). Verifies the happy path (ledger writes always agree with the
 * denormalized `User` balance, since `ledgerService` writes both atomically) and that an
 * artificially-introduced drift is actually detected — proving the check can fail, not just
 * that it always reports clean.
 */
describe('ledgerReconciliationJob (integration)', () => {
  let userId: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {name: 'Reconciliation Test User', username: `recon-user-${randomUUID()}`, email: `recon-user-${randomUUID()}@test.local`, password: 'hashed'},
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.ledgerEntry.deleteMany({where: {userId}});
    await prisma.user.deleteMany({where: {id: userId}});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('finds no variance when ledger writes went through ledgerService normally', async () => {
    await ledgerService.creditCredits(userId, 300, 'bonus', 'SIGNUP_BONUS');
    await ledgerService.creditConnects(userId, 30, 'SIGNUP_BONUS');
    await ledgerService.debitCredits(userId, 50, 'REQUEST_HOLD');

    const result = await ledgerReconciliationJob.runSweep();
    const userVariances = result.variances.filter(v => v.userId === userId);
    expect(userVariances).toHaveLength(0);
  });

  it('detects a variance when the denormalized balance drifts from the ledger', async () => {
    await ledgerService.creditCredits(userId, 100, 'earned', 'CREATOR_REWARD');

    // Simulate a bug/bypass: directly mutate the balance column without a matching LedgerEntry.
    await prisma.user.update({where: {id: userId}, data: {earnedCredits: {increment: 9999}}});

    const result = await ledgerReconciliationJob.runSweep();
    const userVariance = result.variances.find(v => v.userId === userId && v.currency === 'CREDIT');
    expect(userVariance).toBeDefined();
    expect(userVariance?.derived).toBe(100);
    expect(userVariance?.actual).toBe(100 + 9999);
  });
});
