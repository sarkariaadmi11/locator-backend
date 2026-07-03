import {Router} from 'express';

import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  registerFcmToken,
} from '../controllers/notificationController';
import {authenticate} from '../middlewares/authMiddleware';

export const notificationRoutes = Router();

notificationRoutes.use(authenticate);

notificationRoutes.post('/token', registerFcmToken);
notificationRoutes.get('/', getNotifications);
notificationRoutes.patch('/:id/read', markNotificationRead);
notificationRoutes.patch('/read-all', markAllNotificationsRead);
