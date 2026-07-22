import { Router } from 'express';

import type { SessionManager, SessionRequestManager } from '@professor-connect/websocket';

import {
  createPendingSessionsController,
  createActiveSessionsController,
  createSessionDetailsController,
  createSessionHistoryController,
} from '../controllers/sessions-controller.js';

export function createSessionsRouter(
  requestManager: SessionRequestManager,
  sessionManager: SessionManager,
): Router {
  const router = Router();

  router.get('/pending', createPendingSessionsController(requestManager));
  router.get('/history', createSessionHistoryController(requestManager));
  router.get('/active', createActiveSessionsController(sessionManager));
  router.get('/:sessionId', createSessionDetailsController(sessionManager));
  return router;
}
