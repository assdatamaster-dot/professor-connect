import type { Server, Socket } from 'socket.io';

import type { CommunicationLogger } from '../communication/communication.types.js';
import type { SessionManager } from '../active-session/session.manager.js';

export const WEBRTC_SIGNALING_EVENTS = {
  OFFER: 'webrtc:offer',
  ANSWER: 'webrtc:answer',
  ICE_CANDIDATE: 'webrtc:ice-candidate',
} as const;

export interface WebRtcSessionDescription {
  readonly type: 'offer' | 'answer';
  readonly sdp: string;
}

export interface WebRtcDescriptionPayload {
  readonly sessionId: string;
  readonly description: WebRtcSessionDescription;
}

export interface WebRtcIceCandidate {
  readonly candidate: string;
  readonly sdpMid: string | null;
  readonly sdpMLineIndex: number | null;
  readonly usernameFragment: string | null;
}

export interface WebRtcIceCandidatePayload {
  readonly sessionId: string;
  readonly candidate: WebRtcIceCandidate;
}

interface WebRtcClientEvents {
  [WEBRTC_SIGNALING_EVENTS.OFFER]: (payload: WebRtcDescriptionPayload) => void;
  [WEBRTC_SIGNALING_EVENTS.ANSWER]: (payload: WebRtcDescriptionPayload) => void;
  [WEBRTC_SIGNALING_EVENTS.ICE_CANDIDATE]: (payload: WebRtcIceCandidatePayload) => void;
}

type WebRtcSignalingServer = Server<WebRtcClientEvents, WebRtcClientEvents>;
type WebRtcSignalingSocket = Socket<WebRtcClientEvents, WebRtcClientEvents>;

export class WebRtcSignalingGateway {
  public constructor(
    private readonly socketServer: WebRtcSignalingServer,
    private readonly sessionManager: SessionManager,
    private readonly logger: CommunicationLogger,
  ) {}

  public registerEvents(): void {
    this.socketServer.on('connection', (socket) => this.registerSocketEvents(socket));
  }

  private registerSocketEvents(socket: WebRtcSignalingSocket): void {
    socket.on(WEBRTC_SIGNALING_EVENTS.OFFER, (payload) => {
      this.routeDescription(
        socket,
        WEBRTC_SIGNALING_EVENTS.OFFER,
        payload,
        'offer',
        'Offer enviada',
      );
    });
    socket.on(WEBRTC_SIGNALING_EVENTS.ANSWER, (payload) => {
      this.routeDescription(
        socket,
        WEBRTC_SIGNALING_EVENTS.ANSWER,
        payload,
        'answer',
        'Answer enviada',
      );
    });
    socket.on(WEBRTC_SIGNALING_EVENTS.ICE_CANDIDATE, (payload) => {
      this.handleSafely('ICE Candidate inválido', () => {
        const normalizedPayload = requireIceCandidatePayload(payload);
        const route = this.sessionManager.resolveSignalingRoute(
          normalizedPayload.sessionId,
          socket.id,
        );

        this.socketServer
          .to(route.recipientSocketId)
          .emit(WEBRTC_SIGNALING_EVENTS.ICE_CANDIDATE, normalizedPayload);
        this.logger.info('ICE Candidate encaminhado', {
          sessionId: normalizedPayload.sessionId,
          recipientSocketId: route.recipientSocketId,
        });
      });
    });
  }

  private routeDescription(
    socket: WebRtcSignalingSocket,
    event: typeof WEBRTC_SIGNALING_EVENTS.OFFER | typeof WEBRTC_SIGNALING_EVENTS.ANSWER,
    payload: unknown,
    expectedType: WebRtcSessionDescription['type'],
    logMessage: 'Offer enviada' | 'Answer enviada',
  ): void {
    this.handleSafely(`Descrição WebRTC ${expectedType} inválida`, () => {
      const normalizedPayload = requireDescriptionPayload(payload, expectedType);
      const route = this.sessionManager.resolveSignalingRoute(
        normalizedPayload.sessionId,
        socket.id,
      );

      this.socketServer.to(route.recipientSocketId).emit(event, normalizedPayload);
      this.logger.info(logMessage, {
        sessionId: normalizedPayload.sessionId,
        recipientSocketId: route.recipientSocketId,
      });
    });
  }

  private handleSafely(message: string, action: () => void): void {
    try {
      action();
    } catch (error) {
      this.logger.error(message, error);
    }
  }
}

function requireDescriptionPayload(
  payload: unknown,
  expectedType: WebRtcSessionDescription['type'],
): WebRtcDescriptionPayload {
  const record = requireRecord(payload, 'Payload WebRTC');
  const sessionId = requireText(record.sessionId, 'sessionId');
  const description = requireRecord(record.description, 'description');
  if (description.type !== expectedType) {
    throw new Error(`description.type deve ser ${expectedType}`);
  }
  return {
    sessionId,
    description: {
      type: expectedType,
      sdp: requireText(description.sdp, 'description.sdp'),
    },
  };
}

function requireIceCandidatePayload(payload: unknown): WebRtcIceCandidatePayload {
  const record = requireRecord(payload, 'Payload ICE');
  const candidate = requireRecord(record.candidate, 'candidate');
  const sdpMid = requireNullableText(candidate.sdpMid, 'candidate.sdpMid');
  const sdpMLineIndex = candidate.sdpMLineIndex ?? null;
  if (
    sdpMLineIndex !== null &&
    (!Number.isInteger(sdpMLineIndex) || typeof sdpMLineIndex !== 'number' || sdpMLineIndex < 0)
  ) {
    throw new Error('candidate.sdpMLineIndex deve ser um inteiro não negativo ou null');
  }
  return {
    sessionId: requireText(record.sessionId, 'sessionId'),
    candidate: {
      candidate: requireText(candidate.candidate, 'candidate.candidate'),
      sdpMid,
      sdpMLineIndex,
      usernameFragment: requireNullableText(
        candidate.usernameFragment,
        'candidate.usernameFragment',
      ),
    },
  };
}

function requireRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${name} deve ser um objeto`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} é obrigatório`);
  }
  return value;
}

function requireNullableText(value: unknown, name: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${name} deve ser texto ou null`);
  }
  return value;
}
