import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const payoutRequestRepository = {
  create(data: Prisma.PayoutRequestCreateInput) {
    return prisma.payoutRequest.create({data});
  },

  findById(id: string) {
    return prisma.payoutRequest.findUnique({where: {id}, include: {user: true}});
  },

  findPendingForUser(userId: string) {
    return prisma.payoutRequest.findFirst({where: {userId, status: 'PENDING'}});
  },

  update(id: string, data: Prisma.PayoutRequestUpdateInput) {
    return prisma.payoutRequest.update({where: {id}, data});
  },

  findMany<T extends Prisma.PayoutRequestFindManyArgs>(
    params: Prisma.SelectSubset<T, Prisma.PayoutRequestFindManyArgs>,
  ): Prisma.PrismaPromise<Array<Prisma.PayoutRequestGetPayload<T>>> {
    return prisma.payoutRequest.findMany(params);
  },

  count(where: Prisma.PayoutRequestWhereInput) {
    return prisma.payoutRequest.count({where});
  },

  aggregateSum(where: Prisma.PayoutRequestWhereInput) {
    return prisma.payoutRequest.aggregate({where, _sum: {amount: true}});
  },
};
