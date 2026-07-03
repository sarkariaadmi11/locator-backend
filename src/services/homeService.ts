import {User} from '@prisma/client';

import {presentUser} from '../utils/userPresenter';

export const homeService = {
  getHome(user: User) {
    const cityName = user.city ?? 'your city';

    return {
      user: presentUser(user),
      location: {
        city: user.city,
        latitude: user.latitude,
        longitude: user.longitude,
      },
      wallet: {
        balance: Number(user.walletBalance),
        currency: 'INR',
      },
      feed: [
        {
          id: 'welcome',
          title: `Welcome to ${cityName}`,
          description: 'Your personalized local feed is ready.',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'wallet-ready',
          title: 'Wallet ready',
          description: 'Track your balance from the home screen.',
          createdAt: new Date().toISOString(),
        },
      ],
    };
  },
};
