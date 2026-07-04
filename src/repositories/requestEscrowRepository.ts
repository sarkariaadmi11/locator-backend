import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const requestEscrowRepository = {
  create(data: Prisma.RequestEscrowCreateInput) {
    return prisma.requestEscrow.create({data});
  },

  findByRequestId(requestId: string) {
    return prisma.requestEscrow.findUnique({where: {requestId}});
  },

  findById(id: string) {
    return prisma.requestEscrow.findUnique({where: {id}});
  },

  update(id: string, data: Prisma.RequestEscrowUpdateInput) {
    return prisma.requestEscrow.update({where: {id}, data});
  },

  findMany<T extends Prisma.RequestEscrowFindManyArgs>(
    params: Prisma.SelectSubset<T, Prisma.RequestEscrowFindManyArgs>,
  ): Prisma.PrismaPromise<Array<Prisma.RequestEscrowGetPayload<T>>> {
    return prisma.requestEscrow.findMany(params);
  },

  count(where: Prisma.RequestEscrowWhereInput) {
    return prisma.requestEscrow.count({where});
  },

  aggregateSum(where: Prisma.RequestEscrowWhereInput) {
    return prisma.requestEscrow.aggregate({
      where,
      _sum: {amountLocked: true, commissionAmount: true, creatorEarnings: true, refundAmount: true},
    });
  },
};
