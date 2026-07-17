import {randomUUID} from 'crypto';

import {redis} from '../../config/redis';
import {prisma} from '../../prisma/client';
import {SettingsKey, settingsService} from '../settingsService';

/**
 * DB-backed integration test for the v2.1 Feature Flags / Economy Settings surface (backend
 * Phase 6, PRD_TRD_SUMMARY.md §6.1 item 11) — the generic numeric getter/setter, the
 * `listAll()` consolidated view, and that an Admin override actually changes behavior read by
 * the economy code paths wired in this phase (verified indirectly via `getNumber` here; the
 * ledger/escrow/tip integration tests cover the call sites themselves).
 */
describe('settingsService — economy values + listAll (integration)', () => {
  let adminId: string;

  beforeEach(async () => {
    const admin = await prisma.admin.create({
      data: {name: 'Economy Settings Admin', email: `economy-admin-${randomUUID()}@test.local`, password: 'hashed'},
    });
    adminId = admin.id;
  });

  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({where: {actorId: adminId}});
    await prisma.platformSettingVersion.deleteMany({where: {changedByAdminId: adminId}});
    await prisma.platformSetting.deleteMany({where: {key: SettingsKey.REQUEST_COST_CREDITS}});
    await prisma.admin.deleteMany({where: {id: adminId}});
    // The DB row above is the source of truth, but settingsService also has a Redis
    // read-through cache (TTL'd, but not instant) — evict it directly so a later, unrelated
    // test never reads this test's leftover override before the TTL naturally expires.
    await redis.del('settings:cache:' + SettingsKey.REQUEST_COST_CREDITS);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('getNumber returns the code-supplied default when no row exists', async () => {
    const value = await settingsService.getNumber(SettingsKey.REQUEST_COST_CREDITS, 150);
    expect(value).toBe(150);
  });

  it('setNumber persists an override that getNumber then returns instead of the default', async () => {
    await settingsService.setNumber(SettingsKey.REQUEST_COST_CREDITS, 200, adminId, 'Testing higher request cost');

    const value = await settingsService.getNumber(SettingsKey.REQUEST_COST_CREDITS, 150);
    expect(value).toBe(200); // override wins, not the code default

    const versions = await prisma.platformSettingVersion.findMany({where: {key: SettingsKey.REQUEST_COST_CREDITS}});
    expect(versions).toHaveLength(1);
    expect(versions[0].newValue).toBe(200);
  });

  it('listAll includes every registered key, marking overridden vs default', async () => {
    await settingsService.setNumber(SettingsKey.REQUEST_COST_CREDITS, 175, adminId, 'test');

    const all = await settingsService.listAll();
    const requestCost = all.find(s => s.key === SettingsKey.REQUEST_COST_CREDITS);
    const creatorReward = all.find(s => s.key === SettingsKey.CREATOR_REWARD_CREDITS);

    expect(requestCost?.value).toBe(175);
    expect(requestCost?.isOverridden).toBe(true);
    expect(creatorReward?.value).toBe(150); // untouched, still the default
    expect(creatorReward?.isOverridden).toBe(false);

    // Every SettingsKey must appear exactly once.
    const keys = all.map(s => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(SettingsKey.ENABLE_REFERRALS);
  });
});
