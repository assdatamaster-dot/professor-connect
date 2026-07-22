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
  SessionManager,
  SessionService,
  SessionStore,
  type HeartbeatSettings,
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
): CommunicationGateway {
  const socketServer = new SocketServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    serveClient: false,
  });

  const communicationService = new CommunicationService();
  const connectionService = new ConnectionService(new ConnectionManager());
  const presenceService = new PresenceService(new WorkflowPresenceManager(), connectionService);
  const requestService = new RequestService(
    new RequestManager(new RequestStore(), { stateMachineLogger: logger }),
    presenceService,
    requestTimeoutMilliseconds,
  );
  const callService = new CallService(
    new CallManager(new CallStore(), { stateMachineLogger: logger }),
    requestService,
    logger,
  );
  const sessionService = new SessionService(
    new SessionManager(new SessionStore()),
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
  );
  professorPresenceGateway.registerEvents();
  const studentPresenceGateway = new StudentPresenceGateway(
    socketServer,
    studentPresenceManager,
    logger,
    heartbeatSettings.timeoutMs,
    heartbeatSettings.intervalMs,
  );
  studentPresenceGateway.registerEvents();
  const sessionRequestGateway = new SessionRequestGateway(
    socketServer,
    sessionRequestManager,
    logger,
  );
  sessionRequestGateway.registerEvents();

  httpServer.once('close', () => {
    professorPresenceGateway.dispose();
    studentPresenceGateway.dispose();
    sessionRequestGateway.dispose();
  });

  return communicationGateway;
}
