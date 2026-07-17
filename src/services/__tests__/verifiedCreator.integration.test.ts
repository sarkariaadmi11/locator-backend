import {randomUUID} from 'crypto';

import {redis} from '../../config/redis';
import {prisma} from '../../prisma/client';
import {ratingRepository} from '../../repositories/ratingRepository';
import {SettingsKey, settingsService} from '../settingsService';
import {trustScoreService} from '../trustScoreService';
import {verifiedCreatorService} from '../verifiedCreatorService';

/**
 * DB-backed integration test for Verified Creator Badge automation (backend Phase 7,
 * PRD_TRD_SUMMARY.md §4.12) and the Trust Score removal from user-facing responses
 * (PRD_TRD_SUMMARY.md §10 item 2).
 */
describe('verifiedCreatorService (integration)', () => {
  let creatorId: string;
  let requesterId: string;
  let adminId: string;

  beforeEach(async () => {
    const suffix = randomUUID();
    const creator = await prisma.user.create({
      data: {name: 'VC Creator', username: `vc-creator-${suffix}`, email: `vc-creator-${suffix}@test.local`, password: 'hashed'},
    });
    const requester = await prisma.user.create({
      data: {name: 'VC Requester', username: `vc-requester-${suffix}`, email: `vc-requester-${suffix}@test.local`, password: 'hashed'},
    });
    creatorId = creator.id;
    requesterId = requester.id;

    // Low threshold for a fast, deterministic test rather than creating 50 real requests.
    const admin = await prisma.admin.create({data: {name: 'VC Admin', email: `vc-admin-${suffix}@test.local`, password: 'hashed'}});
    adminId = admin.id;
    await settingsService.setNumber(SettingsKey.VERIFIED_CREATOR_THRESHOLD, 2, adminId, 'test');
  });

  afterEach(async () => {
    await prisma.notification.deleteMany({where: {userId: {in: [creatorId, requesterId]}}});
    await prisma.rating.deleteMany({where: {rateeId: creatorId}});
    await prisma.verifiedCreatorStatus.deleteMany({where: {userId: creatorId}});
    await prisma.request.deleteMany({where: {creatorId}});
    await prisma.adminAuditLog.deleteMany({where: {actorId: adminId}});
    await prisma.platformSettingVersion.deleteMany({where: {changedByAdminId: adminId}});
    await prisma.platformSetting.deleteMany({where: {key: SettingsKey.VERIFIED_CREATOR_THRESHOLD}});
    await redis.del('settings:cache:' + SettingsKey.VERIFIED_CREATOR_THRESHOLD);
    await prisma.user.deleteMany({where: {id: {in: [creatorId, requesterId]}}});
    await prisma.admin.deleteMany({where: {id: adminId}});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createCompletedRequest() {
    return prisma.request.create({
      data: {
        requesterId,
        creatorId,
        latitude: 12.9716,
        longitude: 77.5946,
        locationCategory: 'PUBLIC',
        description: 'Verified creator test request',
        durationMinutes: 5,
        rewardAmount: 150,
        category: 'OTHER',
        status: 'COMPLETED',
        requesterDeclarationAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  it('auto-awards once completedCount crosses the threshold', async () => {
    await createCompletedRequest();
    await createCompletedRequest();

    const result = await verifiedCreatorService.evaluate(creatorId);
    expect(result?.isVerified).toBe(true);
    expect(result?.completedCount).toBe(2);

    const user = await prisma.user.findUniqueOrThrow({where: {id: creatorId}});
    expect(user.isVerified).toBe(true);
  });

  it('does not auto-award below the threshold', async () => {
    await createCompletedRequest();

    const result = await verifiedCreatorService.evaluate(creatorId);
    expect(result?.isVerified).toBe(false);
  });

  it('auto-revokes when the account is suspended', async () => {
    await createCompletedRequest();
    await createCompletedRequest();
    await verifiedCreatorService.evaluate(creatorId);

    await prisma.user.update({where: {id: creatorId}, data: {isActive: false}});
    const result = await verifiedCreatorService.evaluate(creatorId);

    expect(result?.isVerified).toBe(false);
    expect(result?.revokedReason).toBe('SUSPENSION');
  });

  it('auto-revokes on a low rolling average and auto-reinstates once it clears', async () => {
    await settingsService.setNumber(SettingsKey.VERIFIED_CREATOR_RATING_WINDOW, 2, adminId, 'test');
    await createCompletedRequest();
    await createCompletedRequest();
    await verifiedCreatorService.evaluate(creatorId);

    const requestForRatings = await createCompletedRequest();
    await ratingRepository.create({
      request: {connect: {id: requestForRatings.id}},
      rater: {connect: {id: requesterId}},
      ratee: {connect: {id: creatorId}},
      role: 'REQUESTER_RATES_CREATOR',
      stars: 1,
    });
    const requestForRatings2 = await createCompletedRequest();
    await ratingRepository.create({
      request: {connect: {id: requestForRatings2.id}},
      rater: {connect: {id: requesterId}},
      ratee: {connect: {id: creatorId}},
      role: 'REQUESTER_RATES_CREATOR',
      stars: 1,
    });

    const revoked = await verifiedCreatorService.evaluate(creatorId);
    expect(revoked?.isVerified).toBe(false);
    expect(revoked?.revokedReason).toBe('LOW_RATING');

    // A good rating pushes the 2-rating rolling window back above the 3.5 minimum.
    const requestForRatings3 = await createCompletedRequest();
    await ratingRepository.create({
      request: {connect: {id: requestForRatings3.id}},
      rater: {connect: {id: requesterId}},
      ratee: {connect: {id: creatorId}},
      role: 'REQUESTER_RATES_CREATOR',
      stars: 5,
    });
    const requestForRatings4 = await createCompletedRequest();
    await ratingRepository.create({
      request: {connect: {id: requestForRatings4.id}},
      rater: {connect: {id: requesterId}},
      ratee: {connect: {id: creatorId}},
      role: 'REQUESTER_RATES_CREATOR',
      stars: 5,
    });

    const reinstated = await verifiedCreatorService.evaluate(creatorId);
    expect(reinstated?.isVerified).toBe(true);
    expect(reinstated?.revokedReason).toBeNull();
  });
});

describe('trustScoreService — user-facing Trust Score removal (integration)', () => {
  let userId: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {name: 'Trust Strip User', username: `trust-strip-${randomUUID()}`, email: `trust-strip-${randomUUID()}@test.local`, password: 'hashed'},
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.user.deleteMany({where: {id: userId}});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('getUserFacingProfile never includes a trustScore field', async () => {
    const profile = await trustScoreService.getUserFacingProfile(userId, 'requester');
    expect(profile).not.toHaveProperty('trustScore');
    // Individual data points must still be present — v2.1's Trust Profile IS these fields.
    expect(profile).toHaveProperty('averageRating');
    expect(profile).toHaveProperty('completedRequests');
    expect(profile).toHaveProperty('badges');
  });

  it('getProfile (internal/admin) still includes trustScore', async () => {
    const profile = await trustScoreService.getProfile(userId, 'requester');
    expect(profile).toHaveProperty('trustScore');
  });
});
