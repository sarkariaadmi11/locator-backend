import {Router} from 'express';

import {accountRoutes} from './accountRoutes';
import {adminRoutes} from './adminRoutes';
import {authRoutes} from './authRoutes';
import {consentRoutes} from './consentRoutes';
import {creatorRoutes} from './creatorRoutes';
import {disputeRoutes} from './disputeRoutes';
import {homeRoutes} from './homeRoutes';
import {locationRoutes} from './locationRoutes';
import {notificationRoutes} from './notificationRoutes';
import {placesRoutes} from './placesRoutes';
import {privacyRoutes} from './privacyRoutes';
import {profileRoutes} from './profileRoutes';
import {reportRoutes} from './reportRoutes';
import {requestRoutes} from './requestRoutes';
import {trustProfileRoutes} from './trustProfileRoutes';
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
apiRoutes.use('/reports', reportRoutes);
apiRoutes.use('/disputes', disputeRoutes);
apiRoutes.use('/creator', creatorRoutes);
apiRoutes.use('/trust-profile', trustProfileRoutes);
apiRoutes.use('/consent', consentRoutes);
apiRoutes.use('/privacy', privacyRoutes);
apiRoutes.use('/account', accountRoutes);
apiRoutes.use('/admin', adminRoutes);
