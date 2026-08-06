import { createServer } from 'node:http';

import { environment } from '@professor-connect/config';
import { DatabasePersistence, describeDatabaseTarget } from '@professor-connect/database';
import {
  initializeWebSocket,
  PresenceManager,
  SessionManager,
  SessionRequestManager,
  StudentPresenceManager,
} from '@professor-connect/websocket';

import { createApp } from './app.js';
import { AuthService } from './auth/auth.service.js';
import { AdminService } from './admin/admin.service.js';
import { BootstrapService } from './bootstrap/bootstrap.service.js';
import { createLogger } from './utils/logger.js';

const persistence = new DatabasePersistence(undefined, (error) => {
  console.error('Falha na fila de persistência', error);
});
const logger = createLogger(persistence.audit);
createLogger().info('Destino PostgreSQL configurado', { ...describeDatabaseTarget() });
const authService = new AuthService();
const bootstrapService = new BootstrapService(authService);

const databaseReadiness = await persistence.assertMigrationsApplied();
const bootstrapStatus = await bootstrapService.initialize();
await persistence.recovery.recoverAfterRestart(new Date(), environment.reconnectWindowMs);
const [requestHistory, sessionHistory] = await Promise.all([
  persistence.sessionRequest.listHistory(),
  persistence.attendanceSession.listHistory(),
]);

const professorPresenceManager = new PresenceManager(undefined, undefined, persistence.professor);
const studentPresenceManager = new StudentPresenceManager(undefined, persistence.student);
const sessionRequestManager = new SessionRequestManager(
  professorPresenceManager,
  studentPresenceManager,
  {
    timeoutMs: environment.requestTimeoutMs,
    persistence: persistence.sessionRequest,
    audit: persistence.audit,
    initialHistory: requestHistory,
  },
);
const activeSessionManager = new SessionManager(professorPresenceManager, studentPresenceManager, {
  persistence: persistence.attendanceSession,
  audit: persistence.audit,
  initialHistory: sessionHistory,
  recoveryWindowMs: environment.reconnectWindowMs,
});
const realtimeUserRevoker: { disconnect(userId: string): void } = {
  disconnect(): void {},
};
const adminService = new AdminService(
  professorPresenceManager,
  studentPresenceManager,
  activeSessionManager,
  (userId) => realtimeUserRevoker.disconnect(userId),
);
const httpServer = createServer(
  createApp(
    professorPresenceManager,
    studentPresenceManager,
    sessionRequestManager,
    activeSessionManager,
    authService,
    adminService,
    bootstrapService,
  ),
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
  activeSessionManager,
  undefined,
  {
    presence: persistence.workflowPresence,
    request: persistence.workflowRequest,
    call: persistence.workflowCall,
    session: persistence.workflowSession,
  },
  persistence.fileTransfer,
  { authenticate: (accessToken) => authService.verifyAccessToken(accessToken) },
);
realtimeUserRevoker.disconnect = (userId) => {
  communicationGateway.disconnectUser(userId);
};

httpServer.on('error', (error) => {
  logger.error('Não foi possível iniciar o servidor', error);
});

httpServer.listen(environment.port, environment.host, () => {
  logger.info('Banco de dados validado', { ...databaseReadiness });
  logger.info('Servidor iniciado', {
    host: environment.host,
    port: environment.port,
  });
  logger.info(
    bootstrapStatus.initialized
      ? 'Configuração inicial detectada'
      : 'Aguardando configuração inicial pelo painel administrativo',
  );
  logger.info('Socket.IO inicializado e aguardando conexões');
});

function shutdown(signal: NodeJS.Signals): void {
  logger.info('Encerrando servidor', { signal });

  communicationGateway.close(async () => {
    try {
      logger.info('Servidor encerrado');
      await persistence.flush();
    } catch (error) {
      console.error('Falha ao finalizar persistência', error);
      process.exitCode = 1;
    } finally {
      await persistence.disconnect();
    }
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
