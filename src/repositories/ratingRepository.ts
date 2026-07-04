import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const ratingRepository = {
  create(data: Prisma.RatingCreateInput) {
    return prisma.rating.create({data});
  },

  findByRequestAndRater(requestId: string, raterId: string) {
    return prisma.rating.findUnique({where: {requestId_raterId: {requestId, raterId}}});
  },

  findByRequestId(requestId: string) {
    return prisma.rating.findMany({where: {requestId}, orderBy: {createdAt: 'asc'}});
  },

  aggregateForUser(rateeId: string) {
    return prisma.rating.aggregate({
      where: {rateeId},
      _avg: {stars: true},
      _count: {stars: true},
    });
  },
};
