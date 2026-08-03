import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { AuthError } from '../auth/auth.types.js';
import { logger } from '../utils/logger.js';

export class HttpError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

export const globalErrorMiddleware: ErrorRequestHandler = (error, _request, response, next) => {
  void next;
  if (error instanceof AuthError) {
    response.status(error.statusCode).json({ code: error.code, message: error.message });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({
      code: 'validation_error',
      message: 'Dados de entrada inválidos',
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }
  if (error instanceof HttpError) {
    response.status(error.statusCode).json({ code: error.code, message: error.message });
    return;
  }
  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    response.status(400).json({ code: 'invalid_json', message: 'JSON inválido' });
    return;
  }
  logger.error('Erro não tratado durante a requisição', error);

  response.status(500).json({
    status: 'error',
    message: 'Erro interno do servidor',
  });
};
