import {randomUUID} from 'crypto';

import {redis} from '../../config/redis';
import {prisma} from '../../prisma/client';
import {postSubmissionChatService} from '../postSubmissionChatService';
import {settingsService} from '../settingsService';

/**
 * DB-backed integration test for the v2.1 Moderation Toggle + Post-Submission Chat (backend
 * Phase 5, PRD_TRD_SUMMARY.md §3.5, §4.10). Covers: default-ON behavior, an Admin flip persisting
 * with a version-history row, and Post-Submission Chat being reachable only when the toggle is
 * OFF and the request is in REQUESTER_REVIEW.
 */
describe('settingsService + postSubmissionChatService (integration)', () => {
  let adminId: string;

  beforeEach(async () => {
    const admin = await prisma.admin.create({
      data: {name: 'Settings Test Admin', email: `settings-admin-${randomUUID()}@test.local`, password: 'hashed'},
    });
    adminId = admin.id;
  });

  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({where: {actorId: adminId}});
    await prisma.platformSettingVersion.deleteMany({where: {changedByAdminId: adminId}});
    await prisma.platformSetting.deleteMany({where: {key: 'MODERATION_TOGGLE'}});
    // Evict the Redis read-through cache too — the TTL alone isn't short enough to prevent a
    // same-run later test from reading this test's leftover override (see settingsService.ts's
    // cacheSet comment for the incident that caught this).
    await redis.del('settings:cache:MODERATION_TOGGLE');
    await prisma.admin.deleteMany({where: {id: adminId}});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('defaults to ON when no row exists yet', async () => {
    const enabled = await settingsService.isModerationEnabled();
    expect(enabled).toBe(true);
  });

  it('persists an Admin-set value and records a version-history row', async () => {
    await settingsService.setModerationEnabled(false, adminId, 'Testing Beta launch without moderation');

    const enabled = await settingsService.isModerationEnabled();
    expect(enabled).toBe(false);

    const versions = await prisma.platformSettingVersion.findMany({where: {key: 'MODERATION_TOGGLE'}});
    expect(versions).toHaveLength(1);
    expect(versions[0].newValue).toBe(false);
    expect(versions[0].reason).toBe('Testing Beta launch without moderation');

    const auditLog = await prisma.adminAuditLog.findMany({where: {actorId: adminId, action: 'SETTINGS_CHANGED'}});
    expect(auditLog).toHaveLength(1);
  });
});

describe('postSubmissionChatService (integration)', () => {
  let requesterId: string;
  let creatorId: string;
  let requestId: string;
  let adminId: string;

  async function createRequest(status: 'REQUESTER_REVIEW' | 'MODERATOR_REVIEW') {
    return prisma.request.create({
      data: {
        requesterId,
        creatorId,
        latitude: 12.9716,
        longitude: 77.5946,
        locationCategory: 'PUBLIC',
        description: 'Post-submission chat test request',
        durationMinutes: 5,
        rewardAmount: 150,
        category: 'OTHER',
        status,
        requesterDeclarationAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  beforeEach(async () => {
    const suffix = randomUUID();
    const requester = await prisma.user.create({
      data: {name: 'PSC Requester', username: `psc-requester-${suffix}`, email: `psc-requester-${suffix}@test.local`, password: 'hashed'},
    });
    const creator = await prisma.user.create({
      data: {name: 'PSC Creator', username: `psc-creator-${suffix}`, email: `psc-creator-${suffix}@test.local`, password: 'hashed'},
    });
    const admin = await prisma.admin.create({
      data: {name: 'PSC Admin', email: `psc-admin-${suffix}@test.local`, password: 'hashed'},
    });
    requesterId = requester.id;
    creatorId = creator.id;
    adminId = admin.id;
  });

  afterEach(async () => {
    await prisma.notification.deleteMany({where: {userId: {in: [requesterId, creatorId]}}});
    await prisma.postSubmissionChatMessage.deleteMany({where: {requestId}});
    await prisma.adminAuditLog.deleteMany({where: {actorId: adminId}});
    await prisma.platformSettingVersion.deleteMany({where: {changedByAdminId: adminId}});
    await prisma.platformSetting.deleteMany({where: {key: 'MODERATION_TOGGLE'}});
    // Evict the Redis read-through cache too — the TTL alone isn't short enough to prevent a
    // same-run later test from reading this test's leftover override (see settingsService.ts's
    // cacheSet comment for the incident that caught this).
    await redis.del('settings:cache:MODERATION_TOGGLE');
    await prisma.request.deleteMany({where: {requesterId}});
    await prisma.user.deleteMany({where: {id: {in: [requesterId, creatorId]}}});
    await prisma.admin.deleteMany({where: {id: adminId}});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('is blocked while moderation is ON (the default)', async () => {
    const request = await createRequest('REQUESTER_REVIEW');
    requestId = request.id;

    await expect(postSubmissionChatService.send(requesterId, requestId, 'hello')).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('works once moderation is OFF and the request is in REQUESTER_REVIEW', async () => {
    await settingsService.setModerationEnabled(false, adminId, 'test');
    const request = await createRequest('REQUESTER_REVIEW');
    requestId = request.id;

    const message = await postSubmissionChatService.send(creatorId, requestId, 'Here is your video!');
    expect(message.senderId).toBe(creatorId);

    const messages = await postSubmissionChatService.list(requesterId, requestId);
    expect(messages).toHaveLength(1);
  });

  it('is blocked outside REQUESTER_REVIEW even with moderation OFF', async () => {
    await settingsService.setModerationEnabled(false, adminId, 'test');
    const request = await createRequest('MODERATOR_REVIEW');
    requestId = request.id;

    await expect(postSubmissionChatService.send(requesterId, requestId, 'too early')).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
