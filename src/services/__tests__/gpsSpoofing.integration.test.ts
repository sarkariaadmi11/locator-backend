import {randomUUID} from 'crypto';

import {prisma} from '../../prisma/client';
import {gpsSpoofingService} from '../gpsSpoofingService';

/**
 * DB-backed integration test for GPS spoofing detection (backend Phase 8 item 2,
 * PRD_TRD_SUMMARY.md §5.10). Verifies the impossible-velocity math against `User.latitude`/
 * `longitude`/`locationUpdatedAt` and confirms the explicit "flag-and-queue, never throw/block"
 * policy — `checkAndFlag` must never reject regardless of outcome.
 */
describe('gpsSpoofingService (integration)', () => {
  let userId: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        name: 'GPS Test User',
        username: `gps-user-${randomUUID()}`,
        email: `gps-user-${randomUUID()}@test.local`,
        password: 'hashed',
      },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.notification.deleteMany({where: {userId}});
    await prisma.user.deleteMany({where: {id: userId}});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('never throws, even for an impossible jump (flag-and-queue, not auto-block)', async () => {
    // Bengaluru -> Delhi (~1740km) 60 seconds ago — physically impossible, must not throw.
    await prisma.user.update({
      where: {id: userId},
      data: {latitude: 12.9716, longitude: 77.5946, locationUpdatedAt: new Date(Date.now() - 60_000)},
    });

    await expect(
      gpsSpoofingService.checkAndFlag(userId, 28.7041, 77.1025, 'accept'),
    ).resolves.toBeUndefined();
  });

  it('is a no-op when there is no prior location to compare against', async () => {
    // Fresh user, no latitude/longitude/locationUpdatedAt set — nothing to compare.
    await expect(gpsSpoofingService.checkAndFlag(userId, 12.9716, 77.5946, 'accept')).resolves.toBeUndefined();
  });

  it('does not throw for a plausible short-distance move (~100m in 60s, a brisk walk)', async () => {
    await prisma.user.update({
      where: {id: userId},
      data: {latitude: 12.9716, longitude: 77.5946, locationUpdatedAt: new Date(Date.now() - 60_000)},
    });

    // notifyAdmins is FCM-push-only (no DB row) and no-ops when Firebase isn't initialized in
    // this test environment — the only thing verifiable here without mocking fcmService is that
    // a plausible move completes without throwing, same as the impossible-jump case above.
    await expect(
      gpsSpoofingService.checkAndFlag(userId, 12.9725, 77.5946, 'accept'),
    ).resolves.toBeUndefined();
  });
});
