import {Response} from 'express';
import {z} from 'zod';

import {asyncHandler} from '../middlewares/asyncHandler';
import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {prisma} from '../prisma/client';
import {notificationRepository} from '../repositories/notificationRepository';
import {sendSuccess} from '../utils/apiResponse';
import {HttpError} from '../utils/httpError';

const registerTokenSchema = z.object({fcmToken: z.string().min(1)});

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
