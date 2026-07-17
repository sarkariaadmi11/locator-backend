import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const ledgerReconciliationRunRepository = {
  create(data: {checkedCount: number; varianceCount: number; variances: Prisma.InputJsonValue}) {
    return prisma.ledgerReconciliationRun.create({data});
  },

  findRecent(limit: number) {
    return prisma.ledgerReconciliationRun.findMany({
      orderBy: {createdAt: 'desc'},
      take: limit,
    });
  },
};
