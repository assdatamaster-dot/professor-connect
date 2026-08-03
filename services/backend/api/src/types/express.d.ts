import type { AuthenticatedIdentity } from '../auth/auth.types.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedIdentity;
    }
  }
}

export {};
