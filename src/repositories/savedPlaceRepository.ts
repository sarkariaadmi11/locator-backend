import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const savedPlaceRepository = {
  create(data: Prisma.SavedPlaceCreateInput) {
    return prisma.savedPlace.create({data});
  },

  findByUserAndPlaceId(userId: string, placeId: string) {
    return prisma.savedPlace.findUnique({where: {userId_placeId: {userId, placeId}}});
  },

  findByIdForUser(id: string, userId: string) {
    return prisma.savedPlace.findFirst({where: {id, userId}});
  },

  findManyForUser(userId: string, skip: number, take: number) {
    return prisma.savedPlace.findMany({
      where: {userId},
      orderBy: {createdAt: 'desc'},
      skip,
      take,
    });
  },

  countForUser(userId: string) {
    return prisma.savedPlace.count({where: {userId}});
  },

  deleteByIdForUser(id: string, userId: string) {
    return prisma.savedPlace.deleteMany({where: {id, userId}});
  },
};
