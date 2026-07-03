import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const transactionRepository = {
  create(data: Prisma.TransactionCreateInput) {
    return prisma.transaction.create({data});
  },

  findById(id: string) {
    return prisma.transaction.findUnique({where: {id}});
  },

  findPendingByOrderId(userId: string, razorpayOrderId: string) {
    return prisma.transaction.findFirst({
      where: {userId, razorpayOrderId, status: 'PENDING'},
    });
  },

  findByOrderId(razorpayOrderId: string) {
    return prisma.transaction.findFirst({where: {razorpayOrderId}});
  },

  update(id: string, data: Prisma.TransactionUpdateInput) {
    return prisma.transaction.update({where: {id}, data});
  },

  /** Atomically flips a PENDING transaction to SUCCESS; count is 0 if it was already resolved (idempotent). */
  markSuccessIfPending(id: string, razorpayPaymentId?: string) {
    return prisma.transaction.updateMany({
      where: {id, status: 'PENDING'},
      data: {status: 'SUCCESS', ...(razorpayPaymentId ? {razorpayPaymentId} : {})},
    });
  },

  /** Atomically flips a PENDING transaction to FAILED; count is 0 if it was already resolved (idempotent). */
  markFailedIfPending(id: string) {
    return prisma.transaction.updateMany({
      where: {id, status: 'PENDING'},
      data: {status: 'FAILED'},
    });
  },

  findPendingOlderThan(cutoff: Date) {
    return prisma.transaction.findMany({
      where: {status: 'PENDING', razorpayOrderId: {not: null}, createdAt: {lt: cutoff}},
    });
  },

  findMany<T extends Prisma.TransactionFindManyArgs>(
    params: Prisma.SelectSubset<T, Prisma.TransactionFindManyArgs>,
  ): Prisma.PrismaPromise<Array<Prisma.TransactionGetPayload<T>>> {
    return prisma.transaction.findMany(params);
  },

  count(where: Prisma.TransactionWhereInput) {
    return prisma.transaction.count({where});
  },

  aggregateSum(where: Prisma.TransactionWhereInput) {
    return prisma.transaction.aggregate({where, _sum: {amount: true}});
  },

  findAllForExport() {
    return prisma.transaction.findMany({
      orderBy: {createdAt: 'desc'},
      include: {user: {select: {name: true, email: true, username: true}}},
    });
  },

  runTransaction<T extends Prisma.PrismaPromise<unknown>[]>(operations: [...T]) {
    return prisma.$transaction(operations);
  },
};
