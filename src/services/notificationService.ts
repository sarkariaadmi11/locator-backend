import {prisma} from '../prisma/client';
import {fcmService} from './fcmService';
import {
  NOTIFICATION_TYPE_CATEGORY,
  NotificationCategory,
  NotificationTypeValue,
  SAFETY_CRITICAL_TYPES,
} from './notificationTypes';

export type NotifyData = Record<string, string>;

/**
 * Single centralized entry point for every business-event notification (backend Phase 12, PRD
 * §8.1/§8.2). Every call site across the codebase should call `notificationService.*` instead of
 * `fcmService.sendToUser`/`sendToMultiple`/`sendToAllAdmins` directly — this is where the
 * per-user category preference (§8.2) is enforced server-side, and where `type` is stamped onto
 * `data` so mobile can deep-link (see `NotificationScreen`). `fcmService` itself is unchanged and
 * still owns the actual push send + in-app `Notification` row write — this module does not
 * duplicate that, it wraps it.
 */
async function isCategoryEnabled(userId: string, type: NotificationTypeValue): Promise<boolean> {
  if (SAFETY_CRITICAL_TYPES.has(type)) return true;

  const category = NOTIFICATION_TYPE_CATEGORY[type];
  if (!category) return true; // unmapped types (shouldn't happen) fail open rather than silently dropping a real event

  const user = await prisma.user.findUnique({
    where: {id: userId},
    select: {notifyRequestActivity: true, notifyPaymentWallet: true, notifyPlatformAlerts: true},
  });
  if (!user) return false;

  if (category === NotificationCategory.REQUEST_ACTIVITY) return user.notifyRequestActivity;
  if (category === NotificationCategory.PAYMENT_WALLET) return user.notifyPaymentWallet;
  return user.notifyPlatformAlerts;
}

export const notificationService = {
  /** Send to one user, honoring their category preference (safety-critical types bypass it). */
  async notifyUser(
    userId: string,
    type: NotificationTypeValue,
    title: string,
    body: string,
    data?: NotifyData,
  ): Promise<void> {
    const enabled = await isCategoryEnabled(userId, type);
    if (!enabled) return;

    await fcmService.sendToUser(userId, {title, body, data: {...data, type}});
  },

  /** Fan out to many users (e.g. nearby-creator broadcast), each gated by their own preference. */
  async notifyMultiple(
    userIds: string[],
    type: NotificationTypeValue,
    title: string,
    body: string,
    data?: NotifyData,
  ): Promise<void> {
    await Promise.allSettled(userIds.map(id => this.notifyUser(id, type, title, body, data)));
  },

  /** Admin alerts — push-only (no `Notification` row; Admins aren't `User` rows), never preference-gated. */
  async notifyAdmins(type: NotificationTypeValue, title: string, body: string, data?: NotifyData): Promise<void> {
    await fcmService.sendToAllAdmins({title, body, data: {...data, type}});
  },
};
