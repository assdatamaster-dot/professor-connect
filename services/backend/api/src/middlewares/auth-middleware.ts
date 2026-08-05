import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { AuthServiceContract } from '../auth/auth.types.js';
import type { UserRole } from '../auth/auth.types.js';

export function authenticate(authService: AuthServiceContract): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const authorization = request.header('authorization');
      if (authorization === undefined || !authorization.startsWith('Bearer ')) {
        response
          .status(401)
          .json({ code: 'authentication_required', message: 'Autenticação obrigatória' });
        return;
      }
      request.auth = await authService.verifyAccessToken(authorization.slice(7));
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requirePermission(permission: string): RequestHandler {
  return (request, response, next): void => {
    if (
      request.auth?.permissions.includes(permission) !== true &&
      request.auth?.roles.includes('ADMIN') !== true
    ) {
      response.status(403).json({ code: 'permission_denied', message: 'Permissão insuficiente' });
      return;
    }
    next();
  };
}

export function requireRole(role: UserRole): RequestHandler {
  return (request, response, next): void => {
    if (request.auth?.roles.includes(role) !== true) {
      response.status(403).json({ code: 'permission_denied', message: 'Permissão insuficiente' });
      return;
    }
    next();
  };
}
