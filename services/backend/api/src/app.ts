import express, { type Express } from 'express';

import { PresenceManager, StudentPresenceManager } from '@professor-connect/websocket';

import { globalErrorMiddleware } from './middlewares/global-error-middleware.js';
import { healthRouter } from './routes/health-router.js';
import { createProfessorsRouter } from './routes/professors-router.js';
import { createStudentsRouter } from './routes/students-router.js';

export function createApp(
  professorPresenceManager = new PresenceManager(),
  studentPresenceManager = new StudentPresenceManager(),
): Express {
  const app = express();

  app.use('/health', healthRouter);
  app.use('/api/professors', createProfessorsRouter(professorPresenceManager));
  app.use('/api/students', createStudentsRouter(studentPresenceManager));
  app.use(globalErrorMiddleware);

  return app;
}
