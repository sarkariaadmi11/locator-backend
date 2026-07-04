import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

// Any status beyond DRAFT/PUBLISHED means the request was picked up by a Creator and (per
// requestService.accept) immediately passed through TEMPORARY_CHAT — used as the "reached
// chat" denominator for Response Rate below.
const POST_CHAT_STATUSES: Prisma.RequestWhereInput['status'] = {notIn: ['DRAFT', 'PUBLISHED']};

/** Trust Profile (PRD §5.8, backend Phase 10) — read-only, computed-on-demand queries. */
export const trustProfileRepository = {
  statusCountsForRequester(userId: string) {
    return prisma.request.groupBy({by: ['status'], where: {requesterId: userId}, _count: {_all: true}});
  },

  statusCountsForCreator(userId: string) {
    return prisma.request.groupBy({by: ['status'], where: {lastAssignedCreatorId: userId}, _count: {_all: true}});
  },

  reshootCountForRequester(userId: string) {
    return prisma.request.count({where: {requesterId: userId, reshootUsed: true}});
  },

  reshootCountForCreator(userId: string) {
    return prisma.request.count({where: {lastAssignedCreatorId: userId, reshootUsed: true}});
  },

  timedOutCountForCreator(userId: string) {
    return prisma.request.count({where: {lastAssignedCreatorId: userId, creatorTimedOut: true}});
  },

  totalAssignedForCreator(userId: string) {
    return prisma.request.count({where: {lastAssignedCreatorId: userId}});
  },

  pickedUpCountForRequester(userId: string) {
    return prisma.request.count({where: {requesterId: userId, lastAssignedCreatorId: {not: null}}});
  },

  async chatResponsivenessForRequester(userId: string) {
    const [reached, responded] = await Promise.all([
      prisma.request.count({where: {requesterId: userId, status: POST_CHAT_STATUSES}}),
      prisma.request.count({
        where: {requesterId: userId, status: POST_CHAT_STATUSES, chatMessages: {some: {senderId: userId}}},
      }),
    ]);
    return {reached, responded};
  },

  async chatResponsivenessForCreator(userId: string) {
    const [reached, responded] = await Promise.all([
      prisma.request.count({where: {lastAssignedCreatorId: userId, status: POST_CHAT_STATUSES}}),
      prisma.request.count({
        where: {
          lastAssignedCreatorId: userId,
          status: POST_CHAT_STATUSES,
          chatMessages: {some: {senderId: userId}},
        },
      }),
    ]);
    return {reached, responded};
  },

  setVerified(userId: string, isVerified: boolean) {
    return prisma.user.update({where: {id: userId}, data: {isVerified}});
  },

  /** Admin list — paginate at the User level, trust stats are computed per-page by the service. */
  findUsersForAdminList(
    filters: {isSuspicious?: boolean; isVerified?: boolean; isActive?: boolean; search?: string},
    skip: number,
    take: number,
  ) {
    const where: Prisma.UserWhereInput = {
      ...(filters.isSuspicious !== undefined ? {isSuspicious: filters.isSuspicious} : {}),
      ...(filters.isVerified !== undefined ? {isVerified: filters.isVerified} : {}),
      ...(filters.isActive !== undefined ? {isActive: filters.isActive} : {}),
      ...(filters.search
        ? {
            OR: [
              {name: {contains: filters.search, mode: 'insensitive'}},
              {username: {contains: filters.search, mode: 'insensitive'}},
              {email: {contains: filters.search, mode: 'insensitive'}},
            ],
          }
        : {}),
    };
    return Promise.all([
      prisma.user.findMany({where, orderBy: {createdAt: 'desc'}, skip, take}),
      prisma.user.count({where}),
    ]);
  },

  countSuspicious() {
    return prisma.user.count({where: {isSuspicious: true}});
  },

  countVerified() {
    return prisma.user.count({where: {isVerified: true}});
  },

  countTotalUsers() {
    return prisma.user.count();
  },
};
