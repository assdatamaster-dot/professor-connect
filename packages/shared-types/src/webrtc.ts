export enum WebRtcNegotiationState {
  NEW = 'NEW',
  OFFER_SENT = 'OFFER_SENT',
  OFFER_RECEIVED = 'OFFER_RECEIVED',
  ANSWER_SENT = 'ANSWER_SENT',
  ANSWER_RECEIVED = 'ANSWER_RECEIVED',
  ICE_EXCHANGING = 'ICE_EXCHANGING',
  CONNECTED = 'CONNECTED',
  FAILED = 'FAILED',
  CLOSED = 'CLOSED',
}

export interface WebRtcNegotiationStatePayload {
  readonly callId: string;
  readonly previousState: WebRtcNegotiationState;
  readonly state: WebRtcNegotiationState;
}

export enum PeerNegotiationState {
  NEW = 'NEW',
  CONNECTING = 'CONNECTING',
  NEGOTIATING = 'NEGOTIATING',
  CONNECTED = 'CONNECTED',
  FAILED = 'FAILED',
  CLOSED = 'CLOSED',
}

export interface PeerNegotiationStatePayload {
  readonly callId: string;
  readonly previousState: PeerNegotiationState;
  readonly state: PeerNegotiationState;
}

export enum DataChannelMessageType {
  PEER_MESSAGE = 'PEER_MESSAGE',
}

export interface DataChannelPayload {
  readonly value: string;
}

export interface DataChannelMessage<TPayload extends DataChannelPayload = DataChannelPayload> {
  readonly type: DataChannelMessageType;
  readonly timestamp: string;
  readonly payload: TPayload;
}
