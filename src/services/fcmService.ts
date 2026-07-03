import {getApps} from 'firebase-admin/app';
import {getMessaging} from 'firebase-admin/messaging';

import {prisma} from '../prisma/client';
import {logger} from '../config/logger';
import {notificationRepository} from '../repositories/notificationRepository';

export type NotificationPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

export const fcmService = {
  async sendToUser(userId: string, payload: NotificationPayload): Promise<void> {
    const user = await prisma.user.findUnique({where: {id: userId}, select: {fcmToken: true}});

    await notificationRepository.create({
      user: {connect: {id: userId}},
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
    });

    if (!user?.fcmToken || getApps().length === 0) return;

    try {
      await getMessaging().send({
        token: user.fcmToken,
        notification: {title: payload.title, body: payload.body},
        data: payload.data,
        android: {priority: 'high'},
      });
    } catch (err) {
      logger.error(`FCM send failed for user ${userId}: ${err}`);
      if ((err as any)?.code === 'messaging/registration-token-not-registered') {
        await prisma.user.update({where: {id: userId}, data: {fcmToken: null}});
      }
    }
  },

  async sendToMultiple(userIds: string[], payload: NotificationPayload): Promise<void> {
    await Promise.allSettled(userIds.map(id => this.sendToUser(id, payload)));
  },

  async sendToAll(payload: NotificationPayload): Promise<void> {
    const users = await prisma.user.findMany({
      where: {isActive: true, fcmToken: {not: null}},
      select: {id: true},
    });
    await this.sendToMultiple(users.map(u => u.id), payload);
  },

  async sendToAllAdmins(payload: NotificationPayload): Promise<void> {
    if (getApps().length === 0) return;

    const admins = await prisma.admin.findMany({
      where: {fcmToken: {not: null}},
      select: {fcmToken: true},
    });

    const tokens = admins.map(a => a.fcmToken!);
    if (tokens.length === 0) return;

    await Promise.allSettled(
      tokens.map(token =>
        getMessaging()
          .send({
            token,
            notification: {title: payload.title, body: payload.body},
            data: payload.data,
            webpush: {
              notification: {title: payload.title, body: payload.body, icon: '/favicon.ico'},
            },
          })
          .catch(err => logger.error(`FCM admin send failed: ${err}`)),
      ),
    );
  },
};
