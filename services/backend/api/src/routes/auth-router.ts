import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import type { AuthServiceContract } from '../auth/auth.types.js';
import { createAuthController } from '../controllers/auth-controller.js';
import { authenticate } from '../middlewares/auth-middleware.js';

export function createAuthRouter(authService: AuthServiceContract): Router {
  const router = Router();
  const controller = createAuthController(authService);
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
      code: 'too_many_attempts',
      message: 'Muitas tentativas. Tente novamente mais tarde.',
    },
  });
  const refreshLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  router.get('/providers', controller.providers);
  router.post('/login', loginLimiter, controller.login);
  router.post('/refresh', refreshLimiter, controller.refresh);
  router.use(authenticate(authService));
  router.get('/me', controller.me);
  router.get('/sessions', controller.sessions);
  router.delete('/sessions/:familyId', controller.revokeSession);
  router.post('/logout', controller.logout);
  router.post('/logout-all', controller.logoutAll);
  router.post('/change-password', controller.changePassword);
  return router;
}
