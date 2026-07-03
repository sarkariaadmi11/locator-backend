import {cert, getApps, initializeApp} from 'firebase-admin/app';
import path from 'path';

import {env} from './env';
import {logger} from './logger';

export function ensureFirebaseInitialized() {
  if (getApps().length > 0) return;

  if (!env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    logger.warn('FIREBASE_SERVICE_ACCOUNT_PATH not set — push notifications disabled.');
    return;
  }

  const keyPath = path.resolve(process.cwd(), env.FIREBASE_SERVICE_ACCOUNT_PATH);

  if (!require('fs').existsSync(keyPath)) {
    logger.warn(`Firebase service account file not found at ${keyPath} — push notifications disabled.`);
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const serviceAccount = require(keyPath);
    initializeApp({credential: cert(serviceAccount)});
    logger.info('Firebase Admin initialized.');
  } catch (err) {
    logger.warn(`Firebase Admin init failed: ${err} — push notifications disabled.`);
  }
}

ensureFirebaseInitialized();
