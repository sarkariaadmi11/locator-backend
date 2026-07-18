import {cert, getApps, initializeApp} from 'firebase-admin/app';
import path from 'path';

import {env} from './env';
import {logger} from './logger';

function tryParse(input: string): Record<string, unknown> | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function tryDecodeBase64(input: string): string | null {
  try {
    const buffer = Buffer.from(input, 'base64');
    return buffer.toString('utf-8');
  } catch {
    return null;
  }
}

function loadServiceAccount(): Record<string, unknown> | null {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsed = tryParse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (parsed) return parsed;
    const decoded = tryDecodeBase64(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (decoded) {
      const result = tryParse(decoded);
      if (result) return result;
    }
    logger.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON as JSON or base64 JSON.');
    return null;
  }

  if (!env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return null;
  }

  const keyPath = path.resolve(process.cwd(), env.FIREBASE_SERVICE_ACCOUNT_PATH);
  if (!require('fs').existsSync(keyPath)) {
    logger.warn(`Firebase service account file not found at ${keyPath}.`);
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(keyPath);
  } catch (err) {
    logger.warn(`Failed to load Firebase service account from ${keyPath}: ${err}`);
    return null;
  }
}

export function ensureFirebaseInitialized() {
  if (getApps().length > 0) return;

  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    logger.warn('FIREBASE_SERVICE_ACCOUNT not configured — push notifications disabled.');
    return;
  }

  try {
    initializeApp({credential: cert(serviceAccount)});
    logger.info('Firebase Admin initialized.');
  } catch (err) {
    logger.warn(`Firebase Admin init failed: ${err} — push notifications disabled.`);
  }
}

ensureFirebaseInitialized();
