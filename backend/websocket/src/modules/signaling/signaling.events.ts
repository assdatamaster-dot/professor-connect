import { EventType } from '@professor-connect/shared-types';

export const SIGNALING_EVENTS = {
  offer: EventType.SIGNAL_OFFER,
  answer: EventType.SIGNAL_ANSWER,
  iceCandidate: EventType.SIGNAL_ICE_CANDIDATE,
  error: EventType.SIGNAL_ERROR,
  screenShareRequest: EventType.SCREEN_SHARE_REQUEST,
  screenShareAccept: EventType.SCREEN_SHARE_ACCEPT,
  screenShareDeny: EventType.SCREEN_SHARE_DENY,
  screenShareStarted: EventType.SCREEN_SHARE_STARTED,
  screenShareStopped: EventType.SCREEN_SHARE_STOPPED,
  screenShareFailed: EventType.SCREEN_SHARE_FAILED,
  remoteRequest: EventType.REMOTE_REQUEST,
  remoteAccept: EventType.REMOTE_ACCEPT,
  remoteDeny: EventType.REMOTE_DENY,
  remoteStarted: EventType.REMOTE_STARTED,
  remoteStopped: EventType.REMOTE_STOPPED,
  remoteExpired: EventType.REMOTE_EXPIRED,
  remoteFailed: EventType.REMOTE_FAILED,
} as const;
