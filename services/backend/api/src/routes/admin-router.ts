import { Router } from 'express';
import multer from 'multer';

import type { AdminServiceContract } from '../admin/admin.types.js';
import type { AuthServiceContract } from '../auth/auth.types.js';
import { createAdminController } from '../controllers/admin-controller.js';
import { authenticate, requireRole } from '../middlewares/auth-middleware.js';

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
): Router {
  const router = Router();
  const controller = createAdminController(adminService);
  router.use(authenticate(authService), requireRole('ADMIN'));
  router.get('/dashboard', controller.dashboard);
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
