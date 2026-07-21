import type { StateTransitionDefinition } from '@professor-connect/services/state-machine';
import { EventType } from '@professor-connect/protocol';

import { ScreenSharingState } from './screen-sharing.types.js';

export const SCREEN_SHARING_EVENTS = {
  request: EventType.SCREEN_SHARE_REQUEST,
  accept: EventType.SCREEN_SHARE_ACCEPT,
  deny: EventType.SCREEN_SHARE_DENY,
  started: EventType.SCREEN_SHARE_STARTED,
  stopped: EventType.SCREEN_SHARE_STOPPED,
  failed: EventType.SCREEN_SHARE_FAILED,
} as const;

const { IDLE, REQUESTED, STARTING, SHARING, STOPPING, STOPPED, FAILED } = ScreenSharingState;

export const SCREEN_SHARING_STATE_TRANSITIONS: readonly StateTransitionDefinition<ScreenSharingState>[] =
  [
    { from: IDLE, to: REQUESTED },
    { from: STOPPED, to: REQUESTED },
    { from: FAILED, to: REQUESTED },
    { from: REQUESTED, to: STARTING },
    { from: REQUESTED, to: STOPPED },
    { from: REQUESTED, to: FAILED },
    { from: STARTING, to: SHARING },
    { from: STARTING, to: FAILED },
    { from: SHARING, to: STOPPING },
    { from: SHARING, to: FAILED },
    { from: STOPPING, to: STOPPED },
    { from: STOPPING, to: FAILED },
    { from: FAILED, to: STOPPED },
  ];
