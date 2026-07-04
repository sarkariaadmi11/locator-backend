import {User} from '@prisma/client';

export const presentUser = (user: User) => ({
  id: user.id,
  name: user.name,
  username: user.username,
  email: user.email,
  profileImage: user.profileImage,
  bio: user.bio,
  city: user.city,
  latitude: user.latitude,
  longitude: user.longitude,
  locationUpdatedAt: user.locationUpdatedAt?.toISOString() ?? null,
  availabilityStatus: user.availabilityStatus,
  walletBalance: Number(user.walletBalance),
  isActive: user.isActive,
  // Compliance & Data Management (backend Phase 13) — welcome-video re-prompt trigger and
  // account-deletion status, so mobile's auth-gate/Privacy Settings can react without a second
  // round-trip. `consecutiveRejections` itself is engineering bookkeeping, not shown in the UI.
  welcomeVideoRepromptPending: user.welcomeVideoRepromptPending,
  deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
  deletionScheduledFor: user.deletionScheduledFor?.toISOString() ?? null,
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
});
