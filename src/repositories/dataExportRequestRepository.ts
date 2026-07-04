import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const dataExportRequestRepository = {
  create(data: Prisma.DataExportRequestCreateInput) {
    return prisma.dataExportRequest.create({data});
  },

  findById(id: string) {
    return prisma.dataExportRequest.findUnique({where: {id}});
  },

  update(id: string, data: Prisma.DataExportRequestUpdateInput) {
    return prisma.dataExportRequest.update({where: {id}, data});
  },

  findManyForUser(userId: string, skip: number, take: number) {
    return Promise.all([
      prisma.dataExportRequest.findMany({
        where: {userId},
        orderBy: {requestedAt: 'desc'},
        skip,
        take,
      }),
      prisma.dataExportRequest.count({where: {userId}}),
    ]);
  },
};
