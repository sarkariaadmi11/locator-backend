import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const ratingRepository = {
  create(data: Prisma.RatingCreateInput) {
    return prisma.rating.create({data});
  },

  findByRequestAndRater(requestId: string, raterId: string) {
    return prisma.rating.findUnique({where: {requestId_raterId: {requestId, raterId}}});
  },

  update(id: string, data: Prisma.RatingUpdateInput) {
    return prisma.rating.update({where: {id}, data});
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

  /** Role-scoped aggregate (e.g. only ratings received *as a Creator*) — used by Highest Rated
   * acceptance mode's winner-picking, which must not conflate a Creator's Requester-side ratings. */
  aggregateForUserRole(rateeId: string, role: 'REQUESTER_RATES_CREATOR' | 'CREATOR_RATES_REQUESTER') {
    return prisma.rating.aggregate({
      where: {rateeId, role},
      _avg: {stars: true},
      _count: {stars: true},
    });
  },

  /** Most recent N ratings received by `rateeId` in role `role` — Verified Creator Badge auto-revoke window (backend Phase 7). */
  findRecentForRateeRole(rateeId: string, role: 'REQUESTER_RATES_CREATOR' | 'CREATOR_RATES_REQUESTER', take: number) {
    return prisma.rating.findMany({
      where: {rateeId, role},
      orderBy: {createdAt: 'desc'},
      take,
      select: {stars: true},
    });
  },
};
