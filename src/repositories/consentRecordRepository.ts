import {ConsentType, Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const consentRecordRepository = {
  create(data: Prisma.ConsentRecordCreateInput) {
    return prisma.consentRecord.create({data});
  },

  findLatestByType(userId: string, type: ConsentType) {
    return prisma.consentRecord.findFirst({
      where: {userId, type},
      orderBy: {acceptedAt: 'desc'},
    });
  },

  findAllForUser(userId: string) {
    return prisma.consentRecord.findMany({
      where: {userId},
      orderBy: {acceptedAt: 'desc'},
    });
  },
};
