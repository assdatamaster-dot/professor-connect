import express, { type Express } from 'express';

import { PresenceManager } from '@professor-connect/websocket';

import { globalErrorMiddleware } from './middlewares/global-error-middleware.js';
import { healthRouter } from './routes/health-router.js';
import { createProfessorsRouter } from './routes/professors-router.js';

export function createApp(presenceManager = new PresenceManager()): Express {
  const app = express();

  app.use('/health', healthRouter);
  app.use('/api/professors', createProfessorsRouter(presenceManager));
  app.use(globalErrorMiddleware);

  return app;
}
