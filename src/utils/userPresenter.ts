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
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
});
