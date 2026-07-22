import { Router } from 'express';

import type { SessionRequestManager } from '@professor-connect/websocket';

import {
  createPendingSessionsController,
  createSessionHistoryController,
} from '../controllers/sessions-controller.js';

export function createSessionsRouter(manager: SessionRequestManager): Router {
  const router = Router();

  router.get('/pending', createPendingSessionsController(manager));
  router.get('/history', createSessionHistoryController(manager));
  return router;
}
