import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import {
  PresenceManager,
  SessionManager,
  SessionRequestManager,
  StudentPresenceManager,
} from '@professor-connect/websocket';
import { environment } from '@professor-connect/config';

import { AuthService } from './auth/auth.service.js';
import type { AuthServiceContract } from './auth/auth.types.js';
import { AdminService } from './admin/admin.service.js';
import type { AdminServiceContract } from './admin/admin.types.js';
import { authenticate, requirePermission } from './middlewares/auth-middleware.js';
import { globalErrorMiddleware, HttpError } from './middlewares/global-error-middleware.js';
import { healthRouter } from './routes/health-router.js';
import { createProfessorsRouter } from './routes/professors-router.js';
import { createStudentsRouter } from './routes/students-router.js';
import { createSessionsRouter } from './routes/sessions-router.js';
import { createAuthRouter } from './routes/auth-router.js';
import { createUsersRouter } from './routes/users-router.js';
import { createAdminRouter } from './routes/admin-router.js';

const adminWebDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../apps/admin-web/dist',
);

export function createApp(
  professorPresenceManager = new PresenceManager(),
  studentPresenceManager = new StudentPresenceManager(),
  sessionRequestManager = new SessionRequestManager(
    professorPresenceManager,
    studentPresenceManager,
  ),
  activeSessionManager = new SessionManager(professorPresenceManager, studentPresenceManager),
  authService: AuthServiceContract = new AuthService(),
  adminService: AdminServiceContract = new AdminService(
    professorPresenceManager,
    studentPresenceManager,
    activeSessionManager,
  ),
): Express {
  const app = express();

  app.disable('x-powered-by');
  if (environment.trustProxy) app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Browsers upgrade HTTP asset URLs to HTTPS when this directive is present. Keep the
          // production hardening, but allow the local HTTP preview used by Electron/development.
          upgradeInsecureRequests: environment.nodeEnv === 'production' ? [] : null,
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors((request, callback) => {
      const origin = request.header('Origin');
      const sameOrigin = origin === `${request.protocol}://${request.host}`;

      if (origin !== undefined && !sameOrigin && !environment.corsOrigins.includes(origin)) {
        callback(new HttpError('Origem CORS não autorizada', 403, 'cors_forbidden'));
        return;
      }

      callback(null, {
        origin: origin === undefined ? false : origin,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Authorization', 'Content-Type'],
        maxAge: 600,
      });
    }),
  );
  app.use(express.json({ limit: '64kb', strict: true }));
  app.use(
    rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  app.use('/health', healthRouter);
  const authRouter = createAuthRouter(authService);
  const usersRouter = createUsersRouter(authService);
  app.use(['/api/auth', '/auth'], authRouter);
  app.use(['/api/users', '/users'], usersRouter);
  app.use('/api/admin', createAdminRouter(authService, adminService));
  app.use(
    '/api/professors',
    authenticate(authService),
    requirePermission('professors.online.read'),
    createProfessorsRouter(professorPresenceManager),
  );
  app.use(
    '/api/students',
    authenticate(authService),
    requirePermission('students.online.read'),
    createStudentsRouter(studentPresenceManager),
  );
  app.use(
    '/api/sessions',
    authenticate(authService),
    requirePermission('sessions.read'),
    createSessionsRouter(sessionRequestManager, activeSessionManager),
  );
  const adminIndex = resolve(adminWebDirectory, 'index.html');
  if (existsSync(adminIndex)) {
    app.use(
      '/admin',
      express.static(adminWebDirectory, {
        immutable: environment.nodeEnv === 'production',
        index: false,
        maxAge: environment.nodeEnv === 'production' ? '1y' : 0,
      }),
    );
    app.get(/^\/admin(?:\/(?!assets(?:\/|$)).*)?$/, (_request, response) =>
      response.sendFile(adminIndex),
    );
  }
  app.use((_request, response) =>
    response.status(404).json({ code: 'not_found', message: 'Recurso não encontrado' }),
  );
  app.use(globalErrorMiddleware);

  return app;
}
