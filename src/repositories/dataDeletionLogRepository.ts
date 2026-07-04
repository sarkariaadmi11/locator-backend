import {DeletionLogAction, Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const dataDeletionLogRepository = {
  create(data: Prisma.DataDeletionLogCreateInput) {
    return prisma.dataDeletionLog.create({data});
  },

  findMany(filters: {userId?: string; action?: DeletionLogAction}, skip: number, take: number) {
    return Promise.all([
      prisma.dataDeletionLog.findMany({
        where: {...filters},
        orderBy: {createdAt: 'desc'},
        skip,
        take,
      }),
      prisma.dataDeletionLog.count({where: {...filters}}),
    ]);
  },
};
