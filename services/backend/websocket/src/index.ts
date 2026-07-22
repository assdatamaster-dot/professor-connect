export { CommunicationGateway } from './modules/communication/communication.gateway.js';
export { COMMUNICATION_EVENTS } from './modules/communication/communication.events.js';
export { CommunicationService } from './modules/communication/communication.service.js';
export type {
  ClientToServerEvents,
  CommunicationLogger,
  CommunicationServer,
  CommunicationSocket,
  CommunicationPingPayload,
  CommunicationPongPayload,
  PingMessage,
  PongResponse,
  ServerToClientEvents,
} from './modules/communication/communication.types.js';
export { SIGNALING_EVENTS } from './modules/signaling/signaling.events.js';
export { SignalingGateway } from './modules/signaling/signaling.gateway.js';
export { SignalingManager } from './modules/signaling/signaling.manager.js';
export { SignalingService } from './modules/signaling/signaling.service.js';
export {
  SignalingError,
  type SignalMessageIdFactory,
  type SignalingCallReader,
  type SignalingClientToServerEvents,
  type SignalingClock,
  type SignalingConnectionReader,
  type SignalingEventType,
  type SignalingLogger,
  type SignalingPresenceReader,
  type SignalingRoute,
  type SignalingRouteRequest,
  type SignalingServerToClientEvents,
  type SignalingSessionReader,
} from './modules/signaling/signaling.types.js';
export { initializeWebSocket } from './socket-server.js';
export {
  PROFESSOR_PRESENCE_EVENTS,
  ProfessorPresenceGateway,
  type ProfessorOnlinePayload,
} from './modules/professor-presence/presence.gateway.js';
export {
  PresenceManager,
  type Professor,
  type RegisterProfessorInput,
} from './modules/professor-presence/presence.manager.js';
