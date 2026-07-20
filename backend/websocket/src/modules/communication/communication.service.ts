import { randomUUID } from 'node:crypto';

import {
  type Call,
  type CallPayload,
  type ConnectionLifecyclePayload,
  type ConnectionRecoveryPayload,
  EventType,
  type HeartbeatPingPayload,
  type ClientPresence,
  type PresenceListPayload,
  type RequestRejectedPayload,
  type ServiceRequest,
  type Session,
  type SessionClosedPayload,
  type SessionCreatedPayload,
  type SocketMessage,
} from '@professor-connect/shared-types';
import type { CallLifecycleEventType } from '@professor-connect/services';

import { COMMUNICATION_EVENTS } from './communication.events.js';
import type {
  CommunicationPongPayload,
  CommunicationServer,
  CommunicationSocket,
  PingMessage,
  PongResponse,
} from './communication.types.js';

type Clock = () => Date;
type MessageIdFactory = () => string;

export class CommunicationService {
  public constructor(
    private readonly clock: Clock = () => new Date(),
    private readonly messageIdFactory: MessageIdFactory = randomUUID,
  ) {}

  public sendPong(socket: CommunicationSocket, request: PingMessage): PongResponse {
    const response = this.createMessage<CommunicationPongPayload>(
      EventType.COMMUNICATION_PONG,
      { type: 'pong' },
      request.sessionId,
    );

    socket.emit(COMMUNICATION_EVENTS.pong, response);

    return response;
  }

  public sendHeartbeatPing(server: CommunicationServer, connectionId: string): void {
    server
      .to(connectionId)
      .emit(
        EventType.HEARTBEAT_PING,
        this.createMessage<HeartbeatPingPayload>(EventType.HEARTBEAT_PING, { type: 'ping' }),
      );
  }

  public broadcastConnectionLifecycle(
    server: CommunicationServer,
    event: EventType.CONNECTION_LOST | EventType.CONNECTION_TIMEOUT,
    payload: ConnectionLifecyclePayload,
  ): void {
    const message = this.createMessage(event, payload);

    if (event === EventType.CONNECTION_LOST) {
      server.emit(EventType.CONNECTION_LOST, message);
      return;
    }

    server.emit(EventType.CONNECTION_TIMEOUT, message);
  }

  public sendConnectionRecovered(
    server: CommunicationServer,
    payload: ConnectionRecoveryPayload,
  ): void {
    server
      .to(payload.connectionId)
      .emit(
        EventType.CONNECTION_RECOVERED,
        this.createMessage(EventType.CONNECTION_RECOVERED, payload),
      );
  }

  public sendSessionCreated(socket: CommunicationSocket, session: Session): void {
    const message = this.createMessage<SessionCreatedPayload>(
      EventType.SESSION_CREATED,
      { session },
      session.id,
    );

    socket.emit(EventType.SESSION_CREATED, message);
  }

  public sendSessionClosed(server: CommunicationServer, session: Session): void {
    const message = this.createMessage<SessionClosedPayload>(
      EventType.SESSION_CLOSED,
      { session },
      session.id,
    );

    server.to(session.id).emit(EventType.SESSION_CLOSED, message);
  }

  public sendOnlineClients(socket: CommunicationSocket, clients: readonly ClientPresence[]): void {
    socket.emit(
      EventType.PRESENCE_ONLINE,
      this.createPresenceListMessage(EventType.PRESENCE_ONLINE, clients),
    );
  }

  public sendAvailableTeachers(
    socket: CommunicationSocket,
    clients: readonly ClientPresence[],
  ): void {
    socket.emit(
      EventType.PRESENCE_AVAILABLE,
      this.createPresenceListMessage(EventType.PRESENCE_AVAILABLE, clients),
    );
  }

  public broadcastOnlineClients(
    server: CommunicationServer,
    clients: readonly ClientPresence[],
  ): void {
    server.emit(
      EventType.PRESENCE_ONLINE,
      this.createPresenceListMessage(EventType.PRESENCE_ONLINE, clients),
    );
  }

  public broadcastAvailableTeachers(
    server: CommunicationServer,
    clients: readonly ClientPresence[],
  ): void {
    server.emit(
      EventType.PRESENCE_AVAILABLE,
      this.createPresenceListMessage(EventType.PRESENCE_AVAILABLE, clients),
    );
  }

  public broadcastBusyClient(server: CommunicationServer, client: ClientPresence): void {
    server.emit(
      EventType.PRESENCE_BUSY,
      this.createPresenceListMessage(EventType.PRESENCE_BUSY, [client]),
    );
  }

  public broadcastOfflineClient(server: CommunicationServer, client: ClientPresence): void {
    server.emit(
      EventType.PRESENCE_OFFLINE,
      this.createPresenceListMessage(EventType.PRESENCE_OFFLINE, [client]),
    );
  }

  public sendRequestCreated(socket: CommunicationSocket, request: ServiceRequest): void {
    socket.emit(
      EventType.REQUEST_CREATED,
      this.createMessage(EventType.REQUEST_CREATED, { request }),
    );
  }

  public sendRequestReceived(
    server: CommunicationServer,
    connectionIds: readonly string[],
    request: ServiceRequest,
  ): void {
    if (connectionIds.length === 0) {
      return;
    }

    server
      .to([...connectionIds])
      .emit(
        EventType.REQUEST_RECEIVED,
        this.createMessage(EventType.REQUEST_RECEIVED, { request }),
      );
  }

  public sendRequestAccepted(
    server: CommunicationServer,
    connectionIds: readonly string[],
    request: ServiceRequest,
  ): void {
    const uniqueConnectionIds = [...new Set(connectionIds)];

    if (uniqueConnectionIds.length === 0) {
      return;
    }

    server
      .to(uniqueConnectionIds)
      .emit(
        EventType.REQUEST_ACCEPTED,
        this.createMessage(EventType.REQUEST_ACCEPTED, { request }),
      );
  }

  public sendRequestRejected(
    socket: CommunicationSocket,
    request: ServiceRequest,
    teacherId: string,
  ): void {
    const payload: RequestRejectedPayload = { request, teacherId };

    socket.emit(
      EventType.REQUEST_REJECTED,
      this.createMessage(EventType.REQUEST_REJECTED, payload),
    );
  }

  public sendRequestCancelled(
    server: CommunicationServer,
    connectionIds: readonly string[],
    request: ServiceRequest,
  ): void {
    const uniqueConnectionIds = [...new Set(connectionIds)];

    if (uniqueConnectionIds.length === 0) {
      return;
    }

    server
      .to(uniqueConnectionIds)
      .emit(
        EventType.REQUEST_CANCELLED,
        this.createMessage(EventType.REQUEST_CANCELLED, { request }),
      );
  }

  public sendRequestExpired(
    server: CommunicationServer,
    connectionIds: readonly string[],
    request: ServiceRequest,
  ): void {
    const uniqueConnectionIds = [...new Set(connectionIds)];

    if (uniqueConnectionIds.length === 0) {
      return;
    }

    server
      .to(uniqueConnectionIds)
      .emit(EventType.REQUEST_EXPIRED, this.createMessage(EventType.REQUEST_EXPIRED, { request }));
  }

  public sendCallLifecycle(
    server: CommunicationServer,
    connectionIds: readonly string[],
    event: CallLifecycleEventType,
    call: Call,
  ): void {
    const uniqueConnectionIds = [...new Set(connectionIds)];

    if (uniqueConnectionIds.length === 0) {
      return;
    }

    const message = this.createMessage<CallPayload>(event, { call });
    const target = server.to(uniqueConnectionIds);

    switch (event) {
      case EventType.CALL_CREATED:
        target.emit(EventType.CALL_CREATED, message);
        break;
      case EventType.CALL_CONNECTING:
        target.emit(EventType.CALL_CONNECTING, message);
        break;
      case EventType.CALL_CONNECTED:
        target.emit(EventType.CALL_CONNECTED, message);
        break;
      case EventType.CALL_FINISHED:
        target.emit(EventType.CALL_FINISHED, message);
        break;
      case EventType.CALL_CANCELLED:
        target.emit(EventType.CALL_CANCELLED, message);
        break;
      case EventType.CALL_FAILED:
        target.emit(EventType.CALL_FAILED, message);
        break;
    }
  }

  public disconnectAll(server: CommunicationServer): void {
    server.disconnectSockets(true);
  }

  private createMessage<T>(event: EventType, payload: T, sessionId?: string): SocketMessage<T> {
    return {
      id: this.messageIdFactory(),
      event,
      timestamp: this.clock().toISOString(),
      ...(sessionId === undefined ? {} : { sessionId }),
      payload,
    };
  }

  private createPresenceListMessage(
    event: EventType,
    clients: readonly ClientPresence[],
  ): SocketMessage<PresenceListPayload> {
    return this.createMessage(event, { clients });
  }
}
