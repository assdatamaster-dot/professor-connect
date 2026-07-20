import type { Server as HttpServer } from 'node:http';

import { Server as SocketServer } from 'socket.io';

export function initializeWebSocket(httpServer: HttpServer): SocketServer {
  return new SocketServer(httpServer, {
    serveClient: false,
  });
}
