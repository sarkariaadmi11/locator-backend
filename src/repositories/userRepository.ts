import {CreatorAvailability, Prisma, User} from '@prisma/client';

import {prisma} from '../prisma/client';

export const userRepository = {
  create(data: Prisma.UserCreateInput) {
    return prisma.user.create({data});
  },

  findByEmail(email: string) {
    return prisma.user.findUnique({where: {email}});
  },

  findByUsername(username: string) {
    return prisma.user.findUnique({where: {username}});
  },

  findByPhone(phone: string) {
    return prisma.user.findUnique({where: {phone}});
  },

  findById(id: string) {
    return prisma.user.findUnique({where: {id}});
  },

  update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({where: {id}, data});
  },

  updatePassword(id: string, passwordHash: string): Promise<User> {
    return prisma.user.update({where: {id}, data: {password: passwordHash}});
  },

  // `city` is optional and only overwritten when resolved (reverse-geocode is best-effort and
  // fires on every GPS ping here, unlike the one-shot onboarding `locationService.save` — a
  // transient geocode failure shouldn't blank out a previously-known city).
  updateLocation(id: string, latitude: number, longitude: number, city?: string | null): Promise<User> {
    return prisma.user.update({
      where: {id},
      data: {latitude, longitude, locationUpdatedAt: new Date(), ...(city !== undefined ? {city} : {})},
    });
  },

  updateAvailability(id: string, availabilityStatus: CreatorAvailability): Promise<User> {
    return prisma.user.update({where: {id}, data: {availabilityStatus}});
  },

  /** Inactive-account cleanup sweep (backend Phase 13) — stale FCM tokens are dead weight. */
  findInactiveWithFcmToken(cutoff: Date) {
    return prisma.user.findMany({
      where: {updatedAt: {lte: cutoff}, fcmToken: {not: null}},
      select: {id: true},
    });
  },

  clearFcmToken(id: string) {
    return prisma.user.update({where: {id}, data: {fcmToken: null}});
  },

  /** Account Deletion hard-delete scheduler (backend Phase 13). */
  findScheduledForHardDelete(now: Date) {
    return prisma.user.findMany({
      where: {deletionScheduledFor: {lte: now}},
      select: {id: true, email: true, username: true},
    });
  },

  /** Time-boxed Suspend User (PRD §5.9.2) auto-reactivation sweep — see `retentionJob`. */
  findExpiredSuspensions(now: Date) {
    return prisma.user.findMany({
      where: {isActive: false, suspendedUntil: {lte: now}},
      select: {id: true},
    });
  },

  reactivateExpiredSuspension(id: string) {
    return prisma.user.update({where: {id}, data: {isActive: true, suspendedUntil: null}});
  },

  /**
   * Irreversible PII anonymization (not a literal row delete — see `accountDeletionService`'s
   * file-level comment for why). `email`/`username` are still `@unique`, so they're replaced
   * with a value derived from the row's own id, which can never collide with a real user's.
   */
  anonymize(id: string) {
    return prisma.user.update({
      where: {id},
      data: {
        name: 'Deleted User',
        username: `deleted-${id}`,
        email: `deleted-${id}@deleted.locator`,
        phone: null,
        phoneVerifiedAt: null,
        password: '',
        profileImage: null,
        bio: null,
        city: null,
        latitude: null,
        longitude: null,
        fcmToken: null,
        isActive: false,
        deletionRequestedAt: null,
        deletionScheduledFor: null,
      },
    });
  },

  /**
   * Coarse bounding-box prefilter of ONLINE creators around a point — exact haversine
   * distance/radius filtering happens in the service layer (see `utils/geo.ts`). Excludes
   * `excludeUserId` so a requester's own account is never matched as its own fulfiller.
   */
  findOnlineCreatorsInBoundingBox(
    minLat: number,
    maxLat: number,
    minLng: number,
    maxLng: number,
    excludeUserId?: string,
  ) {
    return prisma.user.findMany({
      where: {
        availabilityStatus: 'ONLINE',
        isActive: true,
        latitude: {gte: minLat, lte: maxLat},
        longitude: {gte: minLng, lte: maxLng},
        ...(excludeUserId ? {id: {not: excludeUserId}} : {}),
      },
    });
  },
};
