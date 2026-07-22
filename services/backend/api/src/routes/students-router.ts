import { Router } from 'express';

import type { StudentPresenceManager } from '@professor-connect/websocket';

import { createOnlineStudentsController } from '../controllers/online-students-controller.js';

export function createStudentsRouter(presenceManager: StudentPresenceManager): Router {
  const router = Router();

  router.get('/online', createOnlineStudentsController(presenceManager));
  return router;
}
