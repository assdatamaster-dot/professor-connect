import type { Request, Response } from 'express';

import type { SessionRequestManager } from '@professor-connect/websocket';

export function createPendingSessionsController(manager: SessionRequestManager) {
  return function getPendingSessions(_request: Request, response: Response): void {
    response.json(manager.listPendingRequests());
  };
}

export function createSessionHistoryController(manager: SessionRequestManager) {
  return function getSessionHistory(_request: Request, response: Response): void {
    response.json(manager.listHistory());
  };
}
