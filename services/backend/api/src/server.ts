import { createServer } from 'node:http';

import { environment } from '@professor-connect/config';
import {
  initializeWebSocket,
  PresenceManager,
  SessionRequestManager,
  StudentPresenceManager,
} from '@professor-connect/websocket';

import { createApp } from './app.js';
import { logger } from './utils/logger.js';

const professorPresenceManager = new PresenceManager();
const studentPresenceManager = new StudentPresenceManager();
const sessionRequestManager = new SessionRequestManager(
  professorPresenceManager,
  studentPresenceManager,
);
const httpServer = createServer(
  createApp(professorPresenceManager, studentPresenceManager, sessionRequestManager),
);
const communicationGateway = initializeWebSocket(
  httpServer,
  logger,
  environment.requestTimeoutMs,
  {
    intervalMs: environment.heartbeatIntervalMs,
    timeoutMs: environment.heartbeatTimeoutMs,
    reconnectWindowMs: environment.reconnectWindowMs,
  },
  professorPresenceManager,
  studentPresenceManager,
  sessionRequestManager,
);

httpServer.on('error', (error) => {
  logger.error('Não foi possível iniciar o servidor', error);
});

httpServer.listen(environment.port, environment.host, () => {
  logger.info('Servidor iniciado', {
    host: environment.host,
    port: environment.port,
  });
  logger.info('Socket.IO inicializado e aguardando conexões');
});

function shutdown(signal: NodeJS.Signals): void {
  logger.info('Encerrando servidor', { signal });

  communicationGateway.close(() => {
    logger.info('Servidor encerrado');
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
