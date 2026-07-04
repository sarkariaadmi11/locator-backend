import {Response} from 'express';
import {z} from 'zod';

import {asyncHandler} from '../middlewares/asyncHandler';
import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {prisma} from '../prisma/client';
import {notificationRepository} from '../repositories/notificationRepository';
import {sendSuccess} from '../utils/apiResponse';
import {HttpError} from '../utils/httpError';

const registerTokenSchema = z.object({fcmToken: z.string().min(1)});

const updatePreferencesSchema = z.object({
  notifyRequestActivity: z.boolean().optional(),
  notifyPaymentWallet: z.boolean().optional(),
  notifyPlatformAlerts: z.boolean().optional(),
});

export const registerFcmToken = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const {fcmToken} = registerTokenSchema.parse(req.body);
  await prisma.user.update({where: {id: req.user!.id}, data: {fcmToken}});
  sendSuccess(res, 200, 'FCM token registered.', null);
});

export const getNotifications = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page)) || 1);
  const limit = 20;
  const skip = (page - 1) * limit;

  const [notifications, total] = await Promise.all([
    notificationRepository.findManyForUser(req.user!.id, skip, limit),
    notificationRepository.countForUser(req.user!.id),
  ]);

  sendSuccess(res, 200, 'Notifications fetched.', {
    items: notifications,
    page,
    hasMore: skip + notifications.length < total,
  });
});

export const markNotificationRead = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const id = req.params.id as string;
    const notif = await notificationRepository.findById(id);

    if (!notif || notif.userId !== req.user!.id) {
      throw new HttpError(404, 'Notification not found.');
    }

    const updated = await notificationRepository.markRead(id);
    sendSuccess(res, 200, 'Notification marked as read.', updated);
  },
);

export const markAllNotificationsRead = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    await notificationRepository.markAllReadForUser(req.user!.id);
    sendSuccess(res, 200, 'All notifications marked as read.', null);
  },
);

export const getUnreadCount = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const unreadCount = await notificationRepository.countUnreadForUser(req.user!.id);
  sendSuccess(res, 200, 'Unread count fetched.', {unreadCount});
});

/** `GET /notifications/preferences` — the 3 independently toggleable categories (PRD §8.2). */
export const getNotificationPreferences = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: {id: req.user!.id},
    select: {notifyRequestActivity: true, notifyPaymentWallet: true, notifyPlatformAlerts: true},
  });
  if (!user) {
    throw new HttpError(404, 'User not found.');
  }
  sendSuccess(res, 200, 'Notification preferences fetched.', user);
});

/**
 * `PATCH /notifications/preferences` — safety-critical notifications (account suspension,
 * payout rejection) are never gated by these flags, enforced server-side in
 * `notificationService`, not just left to client-side hiding.
 */
export const updateNotificationPreferences = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = updatePreferencesSchema.parse(req.body);
  const updated = await prisma.user.update({
    where: {id: req.user!.id},
    data,
    select: {notifyRequestActivity: true, notifyPaymentWallet: true, notifyPlatformAlerts: true},
  });
  sendSuccess(res, 200, 'Notification preferences updated.', updated);
});
