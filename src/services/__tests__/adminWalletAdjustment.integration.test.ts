import {randomUUID} from 'crypto';

import {prisma} from '../../prisma/client';
import {adminService} from '../adminService';
import {seedAdmins} from '../../utils/seedAdmins';

/**
 * DB-backed integration test for manual Credit/Connect adjustment + the User Management profile
 * drill-down (admin frontend Phase 6, PRD §5.14.4) — mandatory-reason, audit-logged, correctly
 * routes through the same guarded-balance ledger mechanics every other wallet mutation uses.
 */
describe('adminService.adjustWallet / getUserDetail (integration)', () => {
  let adminId: string;
  let userId: string;

  beforeEach(async () => {
    await seedAdmins();
    const admin = await prisma.admin.findFirstOrThrow();
    adminId = admin.id;

    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: {
        name: 'Wallet Adjustment User',
        username: `wallet-adjust-${suffix}`,
        email: `wallet-adjust-${suffix}@test.local`,
        password: 'hashed',
        bonusCredits: 100,
        creatorConnects: 10,
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

  it('credits Credits into the requested bucket and audit-logs the change', async () => {
    const balances = await adminService.adjustWallet(adminId, userId, {
      type: 'CREDITS',
      bucket: 'bonus',
      amount: 50,
      reason: 'Promotional grant',
    });
    expect(balances.videoCredits).toBe(150);

    const auditRows = await prisma.adminAuditLog.findMany({where: {targetEntityId: userId}});
    expect(auditRows.some(r => r.action === 'WALLET_MANUAL_ADJUSTMENT')).toBe(true);
  });

  it('debits Connects and rejects an over-debit', async () => {
    const balances = await adminService.adjustWallet(adminId, userId, {
      type: 'CONNECTS',
      amount: -5,
      reason: 'Correction for support ticket #123',
    });
    expect(balances.creatorConnects).toBe(5);

    await expect(
      adminService.adjustWallet(adminId, userId, {type: 'CONNECTS', amount: -100, reason: 'Too much'}),
    ).rejects.toMatchObject({statusCode: 402});
  });

  it('getUserDetail returns balances and counts', async () => {
    const detail = await adminService.getUserDetail(userId);
    expect(detail.balances.creatorConnects).toBe(10);
    expect(detail.requestsCreatedCount).toBe(0);
    expect(detail.isVerifiedCreator).toBe(false);
  });
});
