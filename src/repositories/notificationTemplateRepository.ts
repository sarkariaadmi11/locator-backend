import {prisma} from '../prisma/client';

export const notificationTemplateRepository = {
  findByType(type: string) {
    return prisma.notificationTemplate.findUnique({where: {type}});
  },

  findAll() {
    return prisma.notificationTemplate.findMany({orderBy: {type: 'asc'}});
  },

  upsert(type: string, title: string, body: string, enabled: boolean) {
    return prisma.notificationTemplate.upsert({
      where: {type},
      create: {type, title, body, enabled},
      update: {title, body, enabled},
    });
  },

  delete(type: string) {
    return prisma.notificationTemplate.delete({where: {type}});
  },
};
