import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const notificationRepository = {
  create(data: Prisma.NotificationCreateInput) {
    return prisma.notification.create({data});
  },

  findById(id: string) {
    return prisma.notification.findUnique({where: {id}});
  },

  findManyForUser(userId: string, skip: number, take: number) {
    return prisma.notification.findMany({
      where: {userId},
      orderBy: {createdAt: 'desc'},
      take,
      skip,
    });
  },

  countForUser(userId: string) {
    return prisma.notification.count({where: {userId}});
  },

  markRead(id: string) {
    return prisma.notification.update({where: {id}, data: {isRead: true}});
  },

  markAllReadForUser(userId: string) {
    return prisma.notification.updateMany({
      where: {userId, isRead: false},
      data: {isRead: true},
    });
  },
};
