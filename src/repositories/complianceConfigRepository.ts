import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const complianceConfigRepository = {
  findByKey(key: string) {
    return prisma.complianceConfig.findUnique({where: {key}});
  },

  findMany() {
    return prisma.complianceConfig.findMany({orderBy: {key: 'asc'}});
  },

  upsert(key: string, value: string, description?: string) {
    return prisma.complianceConfig.upsert({
      where: {key},
      create: {key, value, description},
      update: {value},
    });
  },

  createMany(rows: Prisma.ComplianceConfigCreateManyInput[]) {
    return prisma.complianceConfig.createMany({data: rows, skipDuplicates: true});
  },
};
