import {
  ClientRole,
  EventType,
  PresenceStatus,
  type ClientPresence,
  type HeartbeatPongPayload,
  type PresenceRegisterPayload,
  type PresenceUpdatePayload,
  type RequestReferencePayload,
  type SocketMessage,
} from '@professor-connect/shared-types';
import type {
  CallLifecycleEvent,
  CallService,
  ConnectionService,
  HeartbeatLifecycleEvent,
  HeartbeatService,
  PresenceService,
  RequestDelivery,
  RequestService,
  SessionService,
} from '@professor-connect/services';

import { COMMUNICATION_EVENTS } from './communication.events.js';
import type { CommunicationService } from './communication.service.js';
import type {
  CommunicationLogger,
  CommunicationServer,
  CommunicationSocket,
} from './communication.types.js';

export class CommunicationGateway {
  private readonly stopListeningForCallLifecycle: () => void;
  private readonly stopListeningForHeartbeatLifecycle: () => void;
  private readonly stopListeningForRequestExpiration: () => void;

  public constructor(
    private readonly server: CommunicationServer,
    private readonly communicationService: CommunicationService,
    private readonly connectionService: ConnectionService,
    private readonly presenceService: PresenceService,
    private readonly requestService: RequestService,
    private readonly callService: CallService,
    private readonly sessionService: SessionService,
    private readonly heartbeatService: HeartbeatService,
    private readonly logger: CommunicationLogger,
  ) {
    this.stopListeningForRequestExpiration = this.requestService.onExpired((delivery) => {
      this.handleRequestExpired(delivery);
    });
    this.stopListeningForCallLifecycle = this.callService.onLifecycle((event) => {
      this.handleCallLifecycle(event);
    });
    this.stopListeningForHeartbeatLifecycle = this.heartbeatService.onLifecycle((event) => {
      this.handleHeartbeatLifecycle(event);
    });
  }

  public registerEvents(): void {
    this.heartbeatService.start();
    this.server.on(COMMUNICATION_EVENTS.connection, (socket) => {
      this.handleConnection(socket);
    });
  }

  public close(callback?: () => void): void {
    this.stopListeningForCallLifecycle();
    this.stopListeningForHeartbeatLifecycle();
    this.stopListeningForRequestExpiration();
    this.heartbeatService.stop();
    this.requestService.close();
    this.communicationService.disconnectAll(this.server);
    this.server.close(callback);
  }

  private handleConnection(socket: CommunicationSocket): void {
    this.connectionService.registerClient(socket.id);
    this.logger.info('Cliente conectado', { socketId: socket.id });

    socket.on(COMMUNICATION_EVENTS.ping, (message) => {
      this.handleSafely(EventType.COMMUNICATION_PING, () => {
        this.requireEvent(message, EventType.COMMUNICATION_PING);
        this.connectionService.recordHeartbeat(socket.id);
        this.presenceService.updateLastSeenByConnection(socket.id);
        this.logger.info('Ping recebido', { socketId: socket.id });

        const response = this.communicationService.sendPong(socket, message);

        this.logger.info('Pong enviado', {
          socketId: socket.id,
          timestamp: response.timestamp,
        });
      });
    });

    socket.on(EventType.HEARTBEAT_PONG, (message) => {
      this.handleSafely(EventType.HEARTBEAT_PONG, () => {
        this.requireEvent(message, EventType.HEARTBEAT_PONG);
        this.validateHeartbeatPong(message.payload);
        this.heartbeatService.recordHeartbeat(socket.id);
      });
    });

    socket.on(EventType.SESSION_CREATE, (message) => {
      this.handleSafely(EventType.SESSION_CREATE, () => {
        this.requireEvent(message, EventType.SESSION_CREATE);

        const session = this.sessionService.createSession();

        this.communicationService.sendSessionCreated(socket, session);
        this.logger.info('Sessão criada', { sessionId: session.id });
      });
    });

    socket.on(EventType.SESSION_JOIN, (message) => {
      this.handleSafely(EventType.SESSION_JOIN, () => {
        const sessionId = this.requireSessionEvent(message, EventType.SESSION_JOIN);

        this.sessionService.joinSession(sessionId, socket.id);
        void socket.join(sessionId);
        this.logger.info('Cliente entrou na sessão', { socketId: socket.id, sessionId });
      });
    });

    socket.on(EventType.SESSION_LEAVE, (message) => {
      this.handleSafely(EventType.SESSION_LEAVE, () => {
        const sessionId = this.requireSessionEvent(message, EventType.SESSION_LEAVE);

        this.sessionService.leaveSession(sessionId, socket.id);
        void socket.leave(sessionId);
        this.logger.info('Cliente saiu da sessão', { socketId: socket.id, sessionId });
      });
    });

    socket.on(EventType.SESSION_CLOSE, (message) => {
      this.handleSafely(EventType.SESSION_CLOSE, () => {
        const sessionId = this.requireSessionEvent(message, EventType.SESSION_CLOSE);
        const session = this.sessionService.closeSession(sessionId);

        this.communicationService.sendSessionClosed(this.server, session);
        this.server.in(sessionId).socketsLeave(sessionId);
        this.logger.info('Sessão encerrada', { sessionId });
      });
    });

    socket.on(EventType.PRESENCE_REGISTER, (message) => {
      this.handleSafely(EventType.PRESENCE_REGISTER, () => {
        this.requireEvent(message, EventType.PRESENCE_REGISTER);
        this.validatePresenceRegistration(message.payload);

        const recovery = this.heartbeatService.recoverClient(message.payload.clientId, socket.id);

        if (recovery !== undefined) {
          this.communicationService.broadcastOnlineClients(
            this.server,
            this.presenceService.listOnlineClients(),
          );
          return;
        }

        const client = this.presenceService.registerClient(socket.id, message.payload);

        this.heartbeatService.registerClient(client.clientId, socket.id);

        this.communicationService.broadcastOnlineClients(
          this.server,
          this.presenceService.listOnlineClients(),
        );
        this.logger.info('Cliente registrado', {
          clientId: client.clientId,
          connectionId: client.connectionId,
        });
      });
    });

    socket.on(EventType.PRESENCE_UPDATE, (message) => {
      this.handleSafely(EventType.PRESENCE_UPDATE, () => {
        this.requireEvent(message, EventType.PRESENCE_UPDATE);
        this.validatePresenceUpdate(message.payload);

        const client = this.presenceService.updateStatusByConnection(
          socket.id,
          message.payload.status,
        );

        this.broadcastPresenceStatus(client);
        this.logger.info('Status alterado', {
          clientId: client.clientId,
          status: client.status,
        });
      });
    });

    socket.on(EventType.PRESENCE_ONLINE, (message) => {
      this.handleSafely(EventType.PRESENCE_ONLINE, () => {
        this.requireEvent(message, EventType.PRESENCE_ONLINE);
        this.communicationService.sendOnlineClients(
          socket,
          this.presenceService.listOnlineClients(),
        );
      });
    });

    socket.on(EventType.PRESENCE_AVAILABLE, (message) => {
      this.handleSafely(EventType.PRESENCE_AVAILABLE, () => {
        this.requireEvent(message, EventType.PRESENCE_AVAILABLE);
        this.communicationService.sendAvailableTeachers(
          socket,
          this.presenceService.listAvailableTeachers(),
        );
      });
    });

    socket.on(EventType.REQUEST_CREATE, (message) => {
      this.handleSafely(EventType.REQUEST_CREATE, () => {
        this.requireEvent(message, EventType.REQUEST_CREATE);

        const delivery = this.requestService.createRequest(socket.id);

        this.communicationService.sendRequestCreated(socket, delivery.request);
        this.communicationService.sendRequestReceived(
          this.server,
          delivery.teacherConnectionIds,
          delivery.request,
        );
        this.logger.info('Request criada', { requestId: delivery.request.requestId });
        this.logger.info('Request enviada', {
          requestId: delivery.request.requestId,
          recipientCount: delivery.teacherConnectionIds.length,
        });

        for (const teacherConnectionId of delivery.teacherConnectionIds) {
          this.logger.info('Professor recebeu', {
            requestId: delivery.request.requestId,
            connectionId: teacherConnectionId,
          });
        }
      });
    });

    socket.on(EventType.REQUEST_ACCEPT, (message) => {
      this.handleSafely(EventType.REQUEST_ACCEPT, () => {
        this.requireEvent(message, EventType.REQUEST_ACCEPT);
        this.validateRequestReference(message.payload);

        const delivery = this.requestService.acceptRequest(socket.id, message.payload.requestId);
        const connectionIds = [
          ...delivery.teacherConnectionIds,
          ...(delivery.studentConnectionId === undefined ? [] : [delivery.studentConnectionId]),
        ];

        this.communicationService.sendRequestAccepted(this.server, connectionIds, delivery.request);
        this.logger.info('Professor aceitou', {
          requestId: delivery.request.requestId,
          teacherId: delivery.request.teacherId,
        });

        const call = this.callService.createCall(delivery.request.requestId);

        this.callService.startCall(call.callId);
      });
    });

    socket.on(EventType.REQUEST_REJECT, (message) => {
      this.handleSafely(EventType.REQUEST_REJECT, () => {
        this.requireEvent(message, EventType.REQUEST_REJECT);
        this.validateRequestReference(message.payload);

        const rejection = this.requestService.rejectRequest(socket.id, message.payload.requestId);

        this.communicationService.sendRequestRejected(
          socket,
          rejection.request,
          rejection.teacherId,
        );
        this.logger.info('Professor rejeitou', {
          requestId: rejection.request.requestId,
          teacherId: rejection.teacherId,
        });
      });
    });

    socket.on(EventType.REQUEST_CANCEL, (message) => {
      this.handleSafely(EventType.REQUEST_CANCEL, () => {
        this.requireEvent(message, EventType.REQUEST_CANCEL);
        this.validateRequestReference(message.payload);

        const delivery = this.requestService.cancelRequest(socket.id, message.payload.requestId);
        const connectionIds = [
          ...delivery.teacherConnectionIds,
          ...(delivery.studentConnectionId === undefined ? [] : [delivery.studentConnectionId]),
        ];

        this.communicationService.sendRequestCancelled(
          this.server,
          connectionIds,
          delivery.request,
        );
        this.logger.info('Request cancelada', { requestId: delivery.request.requestId });
      });
    });

    socket.on(COMMUNICATION_EVENTS.disconnect, (reason) => {
      const lostClient = this.heartbeatService.markConnectionLost(socket.id);

      if (lostClient === undefined) {
        this.connectionService.removeClient(socket.id);
      }

      this.logger.info('Cliente desconectado', {
        socketId: socket.id,
        reason,
      });
    });
  }

  private broadcastPresenceStatus(client: ClientPresence): void {
    switch (client.status) {
      case PresenceStatus.ONLINE:
        this.communicationService.broadcastOnlineClients(
          this.server,
          this.presenceService.listOnlineClients(),
        );
        break;
      case PresenceStatus.AVAILABLE:
        this.communicationService.broadcastAvailableTeachers(
          this.server,
          this.presenceService.listAvailableTeachers(),
        );
        break;
      case PresenceStatus.BUSY:
        this.communicationService.broadcastBusyClient(this.server, client);
        break;
      case PresenceStatus.OFFLINE:
        this.communicationService.broadcastOfflineClient(this.server, client);
        break;
    }
  }

  private validatePresenceRegistration(payload: PresenceRegisterPayload): void {
    if (payload.clientId.trim().length === 0 || payload.displayName.trim().length === 0) {
      throw new Error('clientId e displayName são obrigatórios');
    }

    if (!Object.values(ClientRole).includes(payload.role)) {
      throw new Error('Role de presença inválido');
    }
  }

  private validatePresenceUpdate(payload: PresenceUpdatePayload): void {
    if (!Object.values(PresenceStatus).includes(payload.status)) {
      throw new Error('Status de presença inválido');
    }
  }

  private validateHeartbeatPong(payload: HeartbeatPongPayload): void {
    if (payload.type !== 'pong') {
      throw new Error('Resposta de heartbeat inválida');
    }
  }

  private validateRequestReference(payload: RequestReferencePayload): void {
    if (payload.requestId.trim().length === 0) {
      throw new Error('requestId é obrigatório');
    }
  }

  private handleRequestExpired(delivery: RequestDelivery): void {
    const connectionIds = [
      ...delivery.teacherConnectionIds,
      ...(delivery.studentConnectionId === undefined ? [] : [delivery.studentConnectionId]),
    ];

    this.communicationService.sendRequestExpired(this.server, connectionIds, delivery.request);
    this.logger.info('Request expirada', { requestId: delivery.request.requestId });
  }

  private handleCallLifecycle(event: CallLifecycleEvent): void {
    const connectionIds = [event.call.studentId, event.call.teacherId]
      .map((clientId) => this.presenceService.findClient(clientId))
      .filter(
        (client): client is ClientPresence =>
          client !== undefined && client.status !== PresenceStatus.OFFLINE,
      )
      .map((client) => client.connectionId);

    this.communicationService.sendCallLifecycle(
      this.server,
      connectionIds,
      event.event,
      event.call,
    );
  }

  private handleHeartbeatLifecycle(event: HeartbeatLifecycleEvent): void {
    switch (event.event) {
      case EventType.HEARTBEAT_PING:
        this.communicationService.sendHeartbeatPing(this.server, event.connectionId);
        break;
      case EventType.CONNECTION_LOST:
        this.communicationService.broadcastConnectionLifecycle(
          this.server,
          EventType.CONNECTION_LOST,
          event.payload,
        );
        break;
      case EventType.CONNECTION_TIMEOUT: {
        this.server.sockets.sockets.get(event.payload.connectionId)?.disconnect(true);
        this.communicationService.broadcastConnectionLifecycle(
          this.server,
          EventType.CONNECTION_TIMEOUT,
          event.payload,
        );
        const offlineClient = this.presenceService.findClient(event.payload.clientId);

        if (offlineClient !== undefined) {
          this.communicationService.broadcastOfflineClient(this.server, offlineClient);
        }
        break;
      }
      case EventType.CONNECTION_RECOVERED:
        for (const session of event.payload.sessions) {
          void this.server.sockets.sockets.get(event.payload.connectionId)?.join(session.id);
        }
        this.communicationService.sendConnectionRecovered(this.server, event.payload);
        break;
    }
  }

  private handleSafely(event: EventType, action: () => void): void {
    try {
      action();
    } catch (error) {
      this.logger.error(`Falha ao processar o evento ${event}`, error);
    }
  }

  private requireSessionEvent<T>(message: SocketMessage<T>, event: EventType): string {
    this.requireEvent(message, event);

    if (message.sessionId === undefined || message.sessionId.length === 0) {
      throw new Error(`O evento ${event} exige sessionId`);
    }

    return message.sessionId;
  }

  private requireEvent<T>(message: SocketMessage<T>, event: EventType): void {
    if (message.event !== event) {
      throw new Error(`Evento inválido no envelope: esperado ${event}`);
    }

    if (message.id.length === 0 || Number.isNaN(Date.parse(message.timestamp))) {
      throw new Error(`Envelope inválido para o evento ${event}`);
    }
  }
}
