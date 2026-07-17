import {prisma} from '../prisma/client';
import {notificationTemplateRepository} from '../repositories/notificationTemplateRepository';
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

/**
 * Notification Templates (PRD §5.14.9) — additive override. If an `enabled` template row exists
 * for this type, its title/body wins verbatim; otherwise the caller's literal title/body (every
 * existing call site, unchanged) is used as-is. No call site needs to change for this to work.
 */
async function applyTemplate(
  type: NotificationTypeValue,
  title: string,
  body: string,
): Promise<{title: string; body: string}> {
  const template = await notificationTemplateRepository.findByType(type);
  if (template?.enabled) {
    return {title: template.title, body: template.body};
  }
  return {title, body};
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

    const resolved = await applyTemplate(type, title, body);
    await fcmService.sendToUser(userId, {title: resolved.title, body: resolved.body, data: {...data, type}});
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
    const resolved = await applyTemplate(type, title, body);
    await fcmService.sendToAllAdmins({title: resolved.title, body: resolved.body, data: {...data, type}});
  },
};
