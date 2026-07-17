import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const ledgerRepository = {
  create(data: Prisma.LedgerEntryCreateInput) {
    return prisma.ledgerEntry.create({data});
  },

  findByIdempotencyKey(idempotencyKey: string) {
    return prisma.ledgerEntry.findUnique({where: {idempotencyKey}});
  },

  findManyForUser(userId: string, opts: {skip: number; take: number; currency?: 'CREDIT' | 'CONNECT' | 'INR'}) {
    return prisma.ledgerEntry.findMany({
      where: {userId, ...(opts.currency ? {currency: opts.currency} : {})},
      orderBy: {createdAt: 'desc'},
      skip: opts.skip,
      take: opts.take,
    });
  },

  countForUser(userId: string, currency?: 'CREDIT' | 'CONNECT' | 'INR') {
    return prisma.ledgerEntry.count({where: {userId, ...(currency ? {currency} : {})}});
  },
};
