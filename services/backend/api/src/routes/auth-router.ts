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
  const registerLimiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      code: 'too_many_registrations',
      message: 'Muitos cadastros. Tente novamente mais tarde.',
    },
  });

  router.get('/providers', controller.providers);
  router.post('/register', registerLimiter, controller.register);
  router.post('/login', loginLimiter, controller.login);
  router.post('/refresh', refreshLimiter, controller.refresh);
  router.all('/onboard-organization', (_request, response) => {
    response.status(404).json({ code: 'not_found', message: 'Recurso não encontrado' });
  });
  router.use(authenticate(authService));
  router.get('/me', controller.me);
  router.get('/sessions', controller.sessions);
  router.delete('/sessions/:familyId', controller.revokeSession);
  router.post('/logout', controller.logout);
  router.post('/logout-all', controller.logoutAll);
  router.post('/change-password', controller.changePassword);
  return router;
}
