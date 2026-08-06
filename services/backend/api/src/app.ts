import express, { type Express, type Request } from 'express';
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
import { BootstrapService } from './bootstrap/bootstrap.service.js';
import type { BootstrapServiceContract } from './bootstrap/bootstrap.types.js';
import { authenticate, requirePermission } from './middlewares/auth-middleware.js';
import { globalErrorMiddleware, HttpError } from './middlewares/global-error-middleware.js';
import { healthRouter } from './routes/health-router.js';
import { createProfessorsRouter } from './routes/professors-router.js';
import { createStudentsRouter } from './routes/students-router.js';
import { createSessionsRouter } from './routes/sessions-router.js';
import { createAuthRouter } from './routes/auth-router.js';
import { createUsersRouter } from './routes/users-router.js';
import { createAdminRouter } from './routes/admin-router.js';
import { createBootstrapRouter } from './routes/bootstrap-router.js';
import { createVersionRouter } from './routes/version-router.js';

const adminWebDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../apps/admin-web/dist',
);
const adminAssetsDirectory = resolve(adminWebDirectory, 'assets');
const adminIndex = resolve(adminWebDirectory, 'index.html');

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
  bootstrapService: BootstrapServiceContract = new BootstrapService(),
): Express {
  const app = express();

  app.disable('x-powered-by');
  if (environment.trustProxy) app.set('trust proxy', 1);

  // Public files must be resolved before CORS, body parsing, rate limiting and every
  // authentication/authorization middleware. Keep an explicit assets boundary so even a
  // missing asset can never fall through to a protected route or to the SPA fallback.
  app.use(
    '/admin/assets',
    express.static(adminAssetsDirectory, {
      immutable: environment.nodeEnv === 'production',
      index: false,
      maxAge: environment.nodeEnv === 'production' ? '1y' : 0,
      setHeaders(response, filePath) {
        if (filePath.endsWith('.css'))
          response.setHeader('Content-Type', 'text/css; charset=utf-8');
        if (filePath.endsWith('.js')) {
          response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        }
      },
    }),
  );
  app.use('/admin/assets', (_request, response) =>
    response.status(404).json({ code: 'asset_not_found', message: 'Asset não encontrado' }),
  );
  app.use(
    '/admin',
    express.static(adminWebDirectory, {
      index: false,
      maxAge: 0,
    }),
  );

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
    '/updates',
    express.static(environment.updateArtifactsPath, {
      index: false,
      immutable: false,
      maxAge: '5m',
      fallthrough: false,
      setHeaders(response, filePath) {
        if (filePath.endsWith('.yml'))
          response.setHeader('Content-Type', 'text/yaml; charset=utf-8');
        response.setHeader('X-Content-Type-Options', 'nosniff');
      },
    }),
  );
  app.use(
    cors((request, callback) => {
      const origin = request.header('Origin');
      const sameOrigin = origin !== undefined && isSameOriginRequest(request, origin);

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
  app.use('/api/bootstrap', createBootstrapRouter(bootstrapService));
  app.use('/api/version', createVersionRouter());
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
  if (existsSync(adminIndex)) {
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

export function isSameOriginRequest(request: Request, origin: string): boolean {
  const protocols = new Set([
    request.protocol,
    firstForwardedValue(request.header('x-forwarded-proto')),
  ]);
  const hosts = new Set([
    request.host,
    request.header('host'),
    firstForwardedValue(request.header('x-forwarded-host')),
  ]);

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return false;
  }

  for (const protocol of protocols) {
    if (protocol !== 'http' && protocol !== 'https') continue;
    for (const host of hosts) {
      if (host === undefined || host.length === 0) continue;
      try {
        if (new URL(`${protocol}://${host}`).origin === normalizedOrigin) return true;
      } catch {
        // Ignore malformed forwarding values and keep evaluating the remaining candidates.
      }
    }
  }
  return false;
}

function firstForwardedValue(value: string | undefined): string | undefined {
  return value?.split(',', 1)[0]?.trim().toLowerCase();
}
