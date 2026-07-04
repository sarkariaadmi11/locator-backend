import {Router} from 'express';

import {
  getNotificationPreferences,
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  registerFcmToken,
  updateNotificationPreferences,
} from '../controllers/notificationController';
import {authenticate} from '../middlewares/authMiddleware';

export const notificationRoutes = Router();

notificationRoutes.use(authenticate);

notificationRoutes.post('/token', registerFcmToken);
notificationRoutes.get('/', getNotifications);
notificationRoutes.get('/unread-count', getUnreadCount);
notificationRoutes.get('/preferences', getNotificationPreferences);
notificationRoutes.patch('/preferences', updateNotificationPreferences);
notificationRoutes.patch('/:id/read', markNotificationRead);
notificationRoutes.patch('/read-all', markAllNotificationsRead);
