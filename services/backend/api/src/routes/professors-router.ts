import { Router } from 'express';

import type { PresenceManager } from '@professor-connect/websocket';

import { createOnlineProfessorsController } from '../controllers/online-professors-controller.js';

export function createProfessorsRouter(presenceManager: PresenceManager): Router {
  const router = Router();

  router.get('/online', createOnlineProfessorsController(presenceManager));
  return router;
}
