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

  findById(id: string) {
    return prisma.user.findUnique({where: {id}});
  },

  update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({where: {id}, data});
  },

  updatePassword(id: string, passwordHash: string): Promise<User> {
    return prisma.user.update({where: {id}, data: {password: passwordHash}});
  },

  updateLocation(id: string, latitude: number, longitude: number): Promise<User> {
    return prisma.user.update({
      where: {id},
      data: {latitude, longitude, locationUpdatedAt: new Date()},
    });
  },

  updateAvailability(id: string, availabilityStatus: CreatorAvailability): Promise<User> {
    return prisma.user.update({where: {id}, data: {availabilityStatus}});
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
