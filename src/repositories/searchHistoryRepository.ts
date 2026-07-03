import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

const MAX_HISTORY_PER_USER = 50;

export const searchHistoryRepository = {
  create(data: Prisma.SearchHistoryEntryCreateInput) {
    return prisma.searchHistoryEntry.create({data});
  },

  findManyForUser(userId: string, skip: number, take: number) {
    return prisma.searchHistoryEntry.findMany({
      where: {userId},
      orderBy: {createdAt: 'desc'},
      skip,
      take,
    });
  },

  countForUser(userId: string) {
    return prisma.searchHistoryEntry.count({where: {userId}});
  },

  deleteAllForUser(userId: string) {
    return prisma.searchHistoryEntry.deleteMany({where: {userId}});
  },

  /** Caps a user's history at MAX_HISTORY_PER_USER rows, deleting the oldest overflow. */
  async pruneOldest(userId: string) {
    const overflow = await prisma.searchHistoryEntry.findMany({
      where: {userId},
      orderBy: {createdAt: 'desc'},
      skip: MAX_HISTORY_PER_USER,
      select: {id: true},
    });

    if (overflow.length === 0) return;

    await prisma.searchHistoryEntry.deleteMany({
      where: {id: {in: overflow.map(row => row.id)}},
    });
  },
};
