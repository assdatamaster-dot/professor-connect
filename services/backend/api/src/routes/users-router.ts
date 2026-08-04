import { Router } from 'express';

import type { AuthServiceContract } from '../auth/auth.types.js';
import { createUsersController } from '../controllers/users-controller.js';
import { authenticate } from '../middlewares/auth-middleware.js';

export function createUsersRouter(authService: AuthServiceContract): Router {
  const router = Router();
  const controller = createUsersController(authService);
  router.use(authenticate(authService));
  router.get('/me', controller.me);
  router.put('/me', controller.updateMe);
  return router;
}
