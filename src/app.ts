import path from 'path';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import './config/firebase';
import {env} from './config/env';
import {logger} from './config/logger';
import {errorHandler} from './middlewares/errorHandler';
import {notFound} from './middlewares/notFound';
import {prisma} from './prisma/client';
import {apiRoutes} from './routes';

export const app = express();

app.set('trust proxy', 1);
app.use(helmet({crossOriginResourcePolicy: {policy: 'cross-origin'}}));
app.use(
  cors({
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
    credentials: true,
  }),
);
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      (req as express.Request & {rawBody?: Buffer}).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({extended: true}));
app.use(
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }),
);
app.use(`/${env.UPLOAD_DIR}`, express.static(path.resolve(process.cwd(), env.UPLOAD_DIR)));

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({success: true, message: 'OK', database: 'connected'});
  } catch (err) {
    logger.error(`Health check DB probe failed: ${(err as Error).message}`);
    res.status(503).json({success: false, message: 'Database unavailable'});
  }
});

app.use('/api', apiRoutes);
app.use(notFound);
app.use(errorHandler);

logger.info('Express application configured.');
