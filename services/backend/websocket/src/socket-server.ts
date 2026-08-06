import type { Server as HttpServer } from 'node:http';

import { Server as SocketServer } from 'socket.io';

import {
  CallManager,
  CallService,
  CallStore,
  ConnectionManager,
  ConnectionService,
  HeartbeatManager,
  HeartbeatService,
  PresenceManager as WorkflowPresenceManager,
  PresenceService,
  RequestManager,
  RequestService,
  RequestStore,
  SessionManager as WorkflowSessionManager,
  SessionService,
  SessionStore,
  type HeartbeatSettings,
  type WorkflowPersistence,
} from '@professor-connect/services';

import { CommunicationGateway } from './modules/communication/communication.gateway.js';
import { CommunicationService } from './modules/communication/communication.service.js';
import type {
  ClientToServerEvents,
  CommunicationLogger,
  ServerToClientEvents,
} from './modules/communication/communication.types.js';
import { SignalingGateway } from './modules/signaling/signaling.gateway.js';
import { SignalingManager } from './modules/signaling/signaling.manager.js';
import { SignalingService } from './modules/signaling/signaling.service.js';
import { ProfessorPresenceGateway } from './modules/professor-presence/presence.gateway.js';
import { PresenceManager } from './modules/professor-presence/presence.manager.js';
import { StudentPresenceGateway } from './modules/student-presence/student-presence.gateway.js';
import { StudentPresenceManager } from './modules/student-presence/student-presence.manager.js';
import { SessionRequestGateway } from './modules/session-request/session-request.gateway.js';
import { SessionRequestManager } from './modules/session-request/session-request.manager.js';
import { SessionGateway } from './modules/active-session/session.gateway.js';
import { SessionManager } from './modules/active-session/session.manager.js';
import { WebRtcSignalingGateway } from './modules/webrtc-signaling/webrtc-signaling.gateway.js';
import { RemoteControlGateway } from './modules/remote-control/remote-control.gateway.js';
import { FileTransferAuditGateway } from './modules/file-transfer/file-transfer.gateway.js';
import type { FileTransferPersistence } from './persistence/persistence.types.js';
import type { SocketAuthenticationOptions } from './auth/socket-auth.types.js';

export function initializeWebSocket(
  httpServer: HttpServer,
  logger: CommunicationLogger,
  requestTimeoutMilliseconds = 60_000,
  heartbeatSettings: HeartbeatSettings = {
    intervalMs: 30_000,
    timeoutMs: 90_000,
    reconnectWindowMs: 90_000,
  },
  professorPresenceManager = new PresenceManager(),
  studentPresenceManager = new StudentPresenceManager(),
  sessionRequestManager = new SessionRequestManager(
    professorPresenceManager,
    studentPresenceManager,
  ),
  activeSessionManager = new SessionManager(professorPresenceManager, studentPresenceManager),
  remoteControlRequestTimeoutMilliseconds?: number,
  workflowPersistence: WorkflowPersistence = {},
  fileTransferPersistence?: FileTransferPersistence,
  authentication?: SocketAuthenticationOptions,
): CommunicationGateway {
  const connectionLimiter = new SlidingWindowLimiter(60, 60_000);
  const socketServer = new SocketServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    serveClient: false,
    maxHttpBufferSize: 1_000_000,
    connectTimeout: 10_000,
  });

  socketServer.use(async (socket, next) => {
    try {
      if (!connectionLimiter.consume(socket.handshake.address)) {
        throw new Error('Limite de conexões excedido');
      }
      if (authentication === undefined) {
        throw new Error('Autenticação Socket.IO não configurada');
      }
      const handshakeToken = socket.handshake.auth.token;
      const authorization = socket.handshake.headers.authorization;
      const token =
        typeof handshakeToken === 'string'
          ? handshakeToken
          : authorization?.startsWith('Bearer ')
            ? authorization.slice(7)
            : undefined;
      if (token === undefined || token.length === 0) throw new Error('Token ausente');
      const identity = await authentication.authenticate(token);
      if (
        identity.organizationId.length === 0 ||
        !identity.permissions.includes('socket.connect')
      ) {
        throw new Error('Conexão não autorizada');
      }
      socket.data.identity = identity;
      next();
    } catch (error) {
      logger.error('Handshake Socket.IO rejeitado', error);
      next(new Error('unauthorized'));
    }
  });
  socketServer.on('connection', (socket) => {
    const eventLimiter = new SlidingWindowLimiter(1_000, 10_000);
    socket.use((_packet, next) => {
      if (eventLimiter.consume(socket.id)) next();
      else {
        logger.error('Flood Socket.IO bloqueado', new Error('Limite de eventos excedido'));
        next(new Error('rate_limit_exceeded'));
      }
    });
    socket.on('auth:refresh', async (payload, acknowledge) => {
      try {
        if (authentication === undefined || typeof payload?.token !== 'string')
          throw new Error('Token inválido');
        const refreshedIdentity = await authentication.authenticate(payload.token);
        const currentIdentity = socket.data.identity;
        if (
          refreshedIdentity.userId !== currentIdentity.userId ||
          refreshedIdentity.organizationId !== currentIdentity.organizationId ||
          refreshedIdentity.sessionFamilyId !== currentIdentity.sessionFamilyId
        )
          throw new Error('Troca de identidade não autorizada');
        socket.data.identity = refreshedIdentity;
        acknowledge?.({ ok: true });
      } catch {
        acknowledge?.({ ok: false });
        socket.disconnect(true);
      }
    });
  });

  const communicationService = new CommunicationService();
  const connectionService = new ConnectionService(new ConnectionManager());
  const presenceService = new PresenceService(
    new WorkflowPresenceManager(undefined, workflowPersistence.presence),
    connectionService,
  );
  const requestService = new RequestService(
    new RequestManager(new RequestStore(workflowPersistence.request), {
      stateMachineLogger: logger,
    }),
    presenceService,
    requestTimeoutMilliseconds,
  );
  const callService = new CallService(
    new CallManager(new CallStore(workflowPersistence.call), { stateMachineLogger: logger }),
    requestService,
    logger,
  );
  const sessionService = new SessionService(
    new WorkflowSessionManager(new SessionStore(workflowPersistence.session)),
    connectionService,
  );
  const heartbeatService = new HeartbeatService(
    new HeartbeatManager(heartbeatSettings),
    connectionService,
    presenceService,
    {
      replaceSessionConnection: (previousConnectionId, connectionId) =>
        sessionService.replaceClientConnection(previousConnectionId, connectionId),
      releaseSessions: (connectionId) =>
        sessionService.leaveAllSessions(connectionId).map((change) => change.session),
      listPendingRequests: (clientId) => requestService.listPendingRequestsForClient(clientId),
      listActiveCalls: (clientId) => callService.listActiveCallsForClient(clientId),
    },
    heartbeatSettings,
    logger,
  );
  const signalingGateway = new SignalingGateway(
    socketServer,
    new SignalingService(),
    new SignalingManager(sessionService, callService, connectionService, presenceService),
    logger,
  );
  const communicationGateway = new CommunicationGateway(
    socketServer,
    communicationService,
    connectionService,
    presenceService,
    requestService,
    callService,
    sessionService,
    heartbeatService,
    logger,
  );

  communicationGateway.registerEvents();
  signalingGateway.registerEvents();
  const professorPresenceGateway = new ProfessorPresenceGateway(
    socketServer,
    professorPresenceManager,
    logger,
    heartbeatSettings.timeoutMs,
    heartbeatSettings.intervalMs,
    (socketId) => activeSessionManager.recordHeartbeat(socketId),
  );
  professorPresenceGateway.registerEvents();
  const studentPresenceGateway = new StudentPresenceGateway(
    socketServer,
    studentPresenceManager,
    logger,
    heartbeatSettings.timeoutMs,
    heartbeatSettings.intervalMs,
    (socketId) => activeSessionManager.recordHeartbeat(socketId),
  );
  studentPresenceGateway.registerEvents();
  const activeSessionGateway = new SessionGateway(socketServer, activeSessionManager, logger);
  const remoteControlGateway = new RemoteControlGateway(
    socketServer,
    activeSessionManager,
    logger,
    remoteControlRequestTimeoutMilliseconds === undefined
      ? {}
      : { requestTimeoutMs: remoteControlRequestTimeoutMilliseconds },
  );
  remoteControlGateway.registerEvents();
  activeSessionGateway.registerEvents();
  new WebRtcSignalingGateway(socketServer, activeSessionManager, logger).registerEvents();
  if (fileTransferPersistence !== undefined) {
    new FileTransferAuditGateway(
      socketServer,
      activeSessionManager,
      fileTransferPersistence,
      logger,
    ).registerEvents();
  }
  const sessionRequestGateway = new SessionRequestGateway(
    socketServer,
    sessionRequestManager,
    logger,
    activeSessionGateway,
  );
  sessionRequestGateway.registerEvents();

  httpServer.once('close', () => {
    professorPresenceGateway.dispose();
    studentPresenceGateway.dispose();
    sessionRequestGateway.dispose();
    remoteControlGateway.dispose();
    activeSessionGateway.dispose();
  });

  return communicationGateway;
}

class SlidingWindowLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  public constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  public consume(key: string): boolean {
    const now = Date.now();
    const current = this.windows.get(key);
    if (current === undefined || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= this.limit;
  }
}
