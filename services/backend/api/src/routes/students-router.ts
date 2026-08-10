import { Router } from 'express';

import type {
  SessionManager,
  SessionRequestManager,
  StudentPresenceManager,
} from '@professor-connect/websocket';

import { createOnlineStudentsController } from '../controllers/online-students-controller.js';

export function createStudentsRouter(
  presenceManager: StudentPresenceManager,
  requestManager: SessionRequestManager,
  sessionManager: SessionManager,
): Router {
  const router = Router();

  router.get(
    '/online',
    createOnlineStudentsController(presenceManager, requestManager, sessionManager),
  );
  return router;
}
