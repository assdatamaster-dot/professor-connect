import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';

import type { BootstrapServiceContract } from '../bootstrap/bootstrap.types.js';
import { createBootstrapController } from '../controllers/bootstrap-controller.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 2, fields: 1 },
  fileFilter: (_request, file, callback) => {
    callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  },
});

export function createBootstrapRouter(service: BootstrapServiceContract): Router {
  const router = Router();
  const controller = createBootstrapController(service);
  const setupLimiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      code: 'too_many_bootstrap_attempts',
      message: 'Muitas tentativas de configuração. Tente novamente mais tarde.',
    },
  });
  const sessionLimiter = rateLimit({
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

  router.get('/status', controller.status);
  router.post('/session', sessionLimiter, controller.session);
  router.post(
    '/setup',
    setupLimiter,
    upload.fields([
      { name: 'adminAvatar', maxCount: 1 },
      { name: 'logo', maxCount: 1 },
    ]),
    controller.setup,
  );
  return router;
}
