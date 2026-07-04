import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const adminAuditLogRepository = {
  create(data: Prisma.AdminAuditLogCreateInput) {
    return prisma.adminAuditLog.create({data});
  },

  findMany(params: {
    actorId?: string;
    targetEntityType?: string;
    targetEntityId?: string;
    skip: number;
    take: number;
  }) {
    const where: Prisma.AdminAuditLogWhereInput = {
      ...(params.actorId ? {actorId: params.actorId} : {}),
      ...(params.targetEntityType ? {targetEntityType: params.targetEntityType} : {}),
      ...(params.targetEntityId ? {targetEntityId: params.targetEntityId} : {}),
    };

    return Promise.all([
      prisma.adminAuditLog.findMany({
        where,
        orderBy: {createdAt: 'desc'},
        skip: params.skip,
        take: params.take,
        include: {actor: {select: {id: true, name: true, email: true}}},
      }),
      prisma.adminAuditLog.count({where}),
    ]);
  },
};
