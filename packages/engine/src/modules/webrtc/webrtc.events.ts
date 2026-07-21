import type { StateTransitionDefinition } from '@professor-connect/services/state-machine';
import { EventType, WebRtcNegotiationState } from '@professor-connect/protocol';

export const WEBRTC_EVENTS = {
  offer: EventType.SIGNAL_OFFER,
  answer: EventType.SIGNAL_ANSWER,
  iceCandidate: EventType.SIGNAL_ICE_CANDIDATE,
  stateChanged: EventType.WEBRTC_NEGOTIATION_STATE_CHANGED,
} as const;

const { ANSWER_RECEIVED, ANSWER_SENT, CLOSED, CONNECTED, FAILED, ICE_EXCHANGING, NEW } =
  WebRtcNegotiationState;
const { OFFER_RECEIVED, OFFER_SENT } = WebRtcNegotiationState;

const NEGOTIATION_FLOW: readonly StateTransitionDefinition<WebRtcNegotiationState>[] = [
  { from: NEW, to: OFFER_SENT },
  { from: NEW, to: OFFER_RECEIVED },
  { from: OFFER_SENT, to: ANSWER_RECEIVED },
  { from: OFFER_RECEIVED, to: ANSWER_SENT },
  { from: ANSWER_SENT, to: ICE_EXCHANGING },
  { from: ANSWER_RECEIVED, to: ICE_EXCHANGING },
  { from: ICE_EXCHANGING, to: CONNECTED },
];

const FAILURE_SOURCES = [
  NEW,
  OFFER_SENT,
  OFFER_RECEIVED,
  ANSWER_SENT,
  ANSWER_RECEIVED,
  ICE_EXCHANGING,
  CONNECTED,
] as const;
const CLOSE_SOURCES = [...FAILURE_SOURCES, FAILED] as const;

export const WEBRTC_STATE_TRANSITIONS: readonly StateTransitionDefinition<WebRtcNegotiationState>[] =
  [
    ...NEGOTIATION_FLOW,
    ...FAILURE_SOURCES.map((from) => ({ from, to: FAILED })),
    ...CLOSE_SOURCES.map((from) => ({ from, to: CLOSED })),
  ];
