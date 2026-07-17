import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const adminAlertRepository = {
  create(data: {type: string; message: string; metadata?: Prisma.InputJsonValue; userId?: string; requestId?: string}) {
    return prisma.adminAlert.create({data});
  },

  findRecent(limit: number) {
    return prisma.adminAlert.findMany({
      orderBy: {createdAt: 'desc'},
      take: limit,
    });
  },
};
