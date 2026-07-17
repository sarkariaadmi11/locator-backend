import {randomUUID} from 'crypto';

import {prisma} from '../../prisma/client';
import {HttpError} from '../../utils/httpError';
import {ledgerService} from '../ledgerService';

/**
 * DB-backed integration test for the v2.1 Beta Credits/Connects ledger (backend Phase 2, see
 * docs/MASTER_EXECUTION_PLAN.md Phase 2 item 1). Runs against a real Postgres database
 * (`DATABASE_URL`) and exercises `ledgerService` end-to-end — balance-column updates on `User`
 * plus the append-only `LedgerEntry` audit row, spend order, insufficient-balance guards, and
 * idempotency-key replay safety (TRD 8.3).
 */
describe('ledgerService (integration)', () => {
  let userId: string;

  beforeEach(async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: {
        name: 'Ledger Test User',
        username: `ledger-user-${suffix}`,
        email: `ledger-user-${suffix}@test.local`,
        password: 'hashed',
      },
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

  it('grantSignupBonus credits 300 bonus Credits + 30 Connects exactly once (idempotent)', async () => {
    await ledgerService.grantSignupBonus(userId);
    await ledgerService.grantSignupBonus(userId); // replay — must not double-grant

    const balances = await ledgerService.getBalances(userId);
    expect(balances.bonusCredits).toBe(300);
    expect(balances.videoCredits).toBe(300);
    expect(balances.creatorConnects).toBe(30);

    const entries = await prisma.ledgerEntry.findMany({where: {userId}});
    expect(entries).toHaveLength(2); // one CREDIT row, one CONNECT row — not four
  });

  it('debitCredits spends bonus before purchased before earned', async () => {
    await ledgerService.creditCredits(userId, 100, 'earned', 'CREATOR_REWARD');
    await ledgerService.creditCredits(userId, 50, 'purchased', 'TOP_UP');
    await ledgerService.creditCredits(userId, 30, 'bonus', 'SIGNUP_BONUS');

    // Spend 60: should fully drain bonus (30) + purchased (30), leaving purchased=20, earned=100 untouched.
    await ledgerService.debitCredits(userId, 60, 'REQUEST_HOLD');

    const user = await prisma.user.findUniqueOrThrow({where: {id: userId}});
    expect(user.bonusCredits).toBe(0);
    expect(user.purchasedCredits).toBe(20);
    expect(user.earnedCredits).toBe(100);
  });

  it('debitCredits throws 402 when total across all buckets is insufficient', async () => {
    await ledgerService.creditCredits(userId, 10, 'earned', 'CREATOR_REWARD');

    await expect(ledgerService.debitCredits(userId, 50, 'REQUEST_HOLD')).rejects.toMatchObject({
      statusCode: 402,
    } satisfies Partial<HttpError>);

    const user = await prisma.user.findUniqueOrThrow({where: {id: userId}});
    expect(user.earnedCredits).toBe(10); // untouched — failed debit must not partially apply
  });

  it('debitConnects never allows the balance to go negative', async () => {
    await ledgerService.creditConnects(userId, 1, 'SIGNUP_BONUS');

    await ledgerService.debitConnects(userId, 1, 'ACCEPT_SPEND');
    await expect(ledgerService.debitConnects(userId, 1, 'ACCEPT_SPEND')).rejects.toMatchObject({statusCode: 402});

    const user = await prisma.user.findUniqueOrThrow({where: {id: userId}});
    expect(user.creatorConnects).toBe(0);
  });

  it('an idempotencyKey replay returns the original entry without re-applying the balance change', async () => {
    const key = `test-idem-${randomUUID()}`;
    await ledgerService.creditConnects(userId, 5, 'DAILY_CONNECT_BONUS', {idempotencyKey: key});
    await ledgerService.creditConnects(userId, 5, 'DAILY_CONNECT_BONUS', {idempotencyKey: key});

    const user = await prisma.user.findUniqueOrThrow({where: {id: userId}});
    expect(user.creatorConnects).toBe(5); // not 10

    const entries = await prisma.ledgerEntry.findMany({where: {userId}});
    expect(entries).toHaveLength(1);
  });

  it('grantDailyConnectBonusIfDue grants once per IST day and caps the balance at 50', async () => {
    await prisma.user.update({where: {id: userId}, data: {creatorConnects: 48}});

    const first = await ledgerService.grantDailyConnectBonusIfDue(userId);
    expect(first.granted).toBe(true);
    expect((first as {amount: number}).amount).toBe(2); // capped at 50, not the full 5

    const second = await ledgerService.grantDailyConnectBonusIfDue(userId);
    expect(second.granted).toBe(false); // already granted today

    const user = await prisma.user.findUniqueOrThrow({where: {id: userId}});
    expect(user.creatorConnects).toBe(50);
  });
});
