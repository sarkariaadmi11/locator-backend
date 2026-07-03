import {Router} from 'express';

import {adminRoutes} from './adminRoutes';
import {authRoutes} from './authRoutes';
import {creatorRoutes} from './creatorRoutes';
import {homeRoutes} from './homeRoutes';
import {locationRoutes} from './locationRoutes';
import {notificationRoutes} from './notificationRoutes';
import {placesRoutes} from './placesRoutes';
import {profileRoutes} from './profileRoutes';
import {requestRoutes} from './requestRoutes';
import {walletRoutes} from './walletRoutes';

export const apiRoutes = Router();

apiRoutes.use('/auth', authRoutes);
apiRoutes.use('/profile', profileRoutes);
apiRoutes.use('/location', locationRoutes);
apiRoutes.use('/home', homeRoutes);
apiRoutes.use('/wallet', walletRoutes);
apiRoutes.use('/notifications', notificationRoutes);
apiRoutes.use('/places', placesRoutes);
apiRoutes.use('/requests', requestRoutes);
apiRoutes.use('/creator', creatorRoutes);
apiRoutes.use('/admin', adminRoutes);
