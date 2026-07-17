import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const settingsRepository = {
  findByKey(key: string) {
    return prisma.platformSetting.findUnique({where: {key}});
  },

  upsert(key: string, value: Prisma.InputJsonValue, updatedByAdminId?: string) {
    return prisma.platformSetting.upsert({
      where: {key},
      create: {key, value, updatedByAdminId},
      update: {value, updatedByAdminId},
    });
  },

  createVersion(key: string, oldValue: Prisma.InputJsonValue | undefined, newValue: Prisma.InputJsonValue, changedByAdminId: string | undefined, reason: string | undefined) {
    return prisma.platformSettingVersion.create({
      data: {key, oldValue, newValue, changedByAdminId, reason},
    });
  },
};
