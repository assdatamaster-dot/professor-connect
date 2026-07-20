import type { StateTransitionDefinition } from '@professor-connect/services/state-machine';
import { EventType, PeerNegotiationState } from '@professor-connect/shared-types';

export const PEER_EVENTS = {
  offer: EventType.SIGNAL_OFFER,
  answer: EventType.SIGNAL_ANSWER,
  iceCandidate: EventType.SIGNAL_ICE_CANDIDATE,
  stateChanged: EventType.WEBRTC_PEER_STATE_CHANGED,
  dataChannelMessage: EventType.WEBRTC_DATA_CHANNEL_MESSAGE,
} as const;

const { NEW, CONNECTING, NEGOTIATING, CONNECTED, FAILED, CLOSED } = PeerNegotiationState;
const ACTIVE_STATES = [NEW, CONNECTING, NEGOTIATING, CONNECTED] as const;

export const PEER_STATE_TRANSITIONS: readonly StateTransitionDefinition<PeerNegotiationState>[] = [
  { from: NEW, to: CONNECTING },
  { from: CONNECTING, to: NEGOTIATING },
  { from: NEGOTIATING, to: CONNECTED },
  ...ACTIVE_STATES.map((from) => ({ from, to: FAILED })),
  ...ACTIVE_STATES.map((from) => ({ from, to: CLOSED })),
  { from: FAILED, to: CLOSED },
];
