import type { ErrorRequestHandler } from 'express';

import { logger } from '../utils/logger.js';

export const globalErrorMiddleware: ErrorRequestHandler = (error, _request, response, next) => {
  void next;
  logger.error('Erro não tratado durante a requisição', error);

  response.status(500).json({
    status: 'error',
    message: 'Internal server error',
  });
};
