import { CallStatus, SessionStatus, SignalErrorCode } from '@professor-connect/shared-types';

import type {
  SignalingCallReader,
  SignalingConnectionReader,
  SignalingPresenceReader,
  SignalingRoute,
  SignalingRouteRequest,
  SignalingSessionReader,
} from './signaling.types.js';
import { SignalingError } from './signaling.types.js';

const REQUIRED_SIGNALING_CLIENTS = 2;
const TERMINAL_CALL_STATUSES: ReadonlySet<CallStatus> = new Set([
  CallStatus.FINISHED,
  CallStatus.FAILED,
  CallStatus.CANCELLED,
]);

export class SignalingManager {
  public constructor(
    private readonly sessionReader: SignalingSessionReader,
    private readonly callReader: SignalingCallReader,
    private readonly connectionReader: SignalingConnectionReader,
    private readonly presenceReader: SignalingPresenceReader,
  ) {}

  public resolveRoute(request: SignalingRouteRequest): SignalingRoute {
    const session = this.sessionReader.findSession(request.sessionId);

    if (session === undefined) {
      throw new SignalingError(
        SignalErrorCode.SESSION_NOT_FOUND,
        `Sessão não encontrada: ${request.sessionId}`,
      );
    }

    if (session.status !== SessionStatus.ACTIVE) {
      throw new SignalingError(
        SignalErrorCode.SESSION_NOT_ACTIVE,
        `Sessão não está ativa: ${request.sessionId}`,
      );
    }

    if (session.clientIds.length !== REQUIRED_SIGNALING_CLIENTS) {
      throw new SignalingError(
        SignalErrorCode.INVALID_SESSION_CLIENT_COUNT,
        `Sessão deve possuir exatamente dois clientes: ${request.sessionId}`,
      );
    }

    if (!session.clientIds.includes(request.senderConnectionId)) {
      throw new SignalingError(
        SignalErrorCode.CLIENT_NOT_IN_SESSION,
        `Cliente não pertence à sessão: ${request.senderConnectionId}`,
      );
    }

    for (const connectionId of session.clientIds) {
      if (!this.connectionReader.isConnected(connectionId)) {
        throw new SignalingError(
          SignalErrorCode.CLIENT_NOT_CONNECTED,
          `Cliente da sessão não está conectado: ${connectionId}`,
        );
      }
    }

    const call = this.callReader.findCall(request.callId);

    if (call === undefined) {
      throw new SignalingError(
        SignalErrorCode.CALL_NOT_FOUND,
        `Call não encontrada: ${request.callId}`,
      );
    }

    if (TERMINAL_CALL_STATUSES.has(call.status)) {
      throw new SignalingError(
        SignalErrorCode.CALL_NOT_ACTIVE,
        `Call não está ativa: ${request.callId}`,
      );
    }

    if (call.sessionId !== undefined && call.sessionId !== request.sessionId) {
      throw new SignalingError(
        SignalErrorCode.CALL_SESSION_MISMATCH,
        `Call não pertence à sessão: ${request.callId}`,
      );
    }

    const sessionClientIds = session.clientIds.map((connectionId) => {
      const presence = this.presenceReader.findByConnectionId(connectionId);

      if (presence === undefined) {
        throw new SignalingError(
          SignalErrorCode.CLIENT_PRESENCE_NOT_FOUND,
          `Presença não encontrada para a conexão: ${connectionId}`,
        );
      }

      return presence.clientId;
    });
    const callParticipantIds = new Set([call.studentId, call.teacherId]);

    if (
      sessionClientIds.some((clientId) => !callParticipantIds.has(clientId)) ||
      callParticipantIds.size !== REQUIRED_SIGNALING_CLIENTS
    ) {
      throw new SignalingError(
        SignalErrorCode.CALL_PARTICIPANT_MISMATCH,
        `Participantes da Call não correspondem aos clientes da sessão: ${request.callId}`,
      );
    }

    const recipientConnectionId = session.clientIds.find(
      (connectionId) => connectionId !== request.senderConnectionId,
    );

    if (recipientConnectionId === undefined) {
      throw new SignalingError(
        SignalErrorCode.INVALID_SESSION_CLIENT_COUNT,
        `Não foi possível resolver o destinatário da sessão: ${request.sessionId}`,
      );
    }

    return { recipientConnectionId };
  }
}
