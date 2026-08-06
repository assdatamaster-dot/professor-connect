import { Router } from 'express';
import multer from 'multer';

import type { AdminServiceContract } from '../admin/admin.types.js';
import type { AuthServiceContract } from '../auth/auth.types.js';
import { createAdminController } from '../controllers/admin-controller.js';
import { authenticate, requireRole } from '../middlewares/auth-middleware.js';
import { VersionService } from '../version/version.service.js';
import type { VersionServiceContract } from '../version/version.types.js';
import { z } from 'zod';

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
  fileFilter: (_request, file, callback) => {
    callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  },
});

export function createAdminRouter(
  authService: AuthServiceContract,
  adminService: AdminServiceContract,
  versionService: VersionServiceContract = new VersionService(),
): Router {
  const router = Router();
  const controller = createAdminController(adminService);
  router.use(authenticate(authService), requireRole('ADMIN'));
  router.get('/dashboard', controller.dashboard);
  router.get('/updates', async (_request, response, next) => {
    try {
      response.json(await versionService.metrics());
    } catch (error) {
      next(error);
    }
  });
  router.post('/updates/releases', async (request, response, next) => {
    try {
      const input = z
        .object({
          application: z.enum(['teacher', 'student']),
          channel: z.enum(['stable', 'beta', 'development']),
          version: z
            .string()
            .trim()
            .regex(/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
          releaseNotes: z.record(z.string(), z.unknown()),
          url: z.url({ protocol: /^https$/ }),
          sha512: z.string().min(80).max(200),
          checksum: z.string().min(32).max(200),
          signature: z.string().min(32).max(4_096).optional(),
          publishedAt: z.iso.datetime().optional(),
        })
        .parse(request.body);
      response.status(201).json(await versionService.publish(input));
    } catch (error) {
      next(error);
    }
  });
  router.get('/users', controller.listUsers);
  router.post('/users', controller.createUser);
  router.put('/users/:userId', controller.updateUser);
  router.put('/users/:userId/status', controller.updateStatus);
  router.post('/users/:userId/reset-password', controller.resetPassword);
  router.get('/users/:userId/avatar', controller.getAvatar);
  router.post('/users/:userId/avatar', avatarUpload.single('avatar'), controller.saveAvatar);
  router.delete('/users/:userId/avatar', controller.deleteAvatar);
  router.delete('/users/:userId', controller.deleteUser);
  return router;
}
