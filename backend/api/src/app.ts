import express, { type Express } from 'express';

import { globalErrorMiddleware } from './middlewares/global-error-middleware.js';
import { healthRouter } from './routes/health-router.js';

export function createApp(): Express {
  const app = express();

  app.use('/health', healthRouter);
  app.use(globalErrorMiddleware);

  return app;
}
