import type { StateTransitionDefinition } from '@professor-connect/services/state-machine';
import { EventType } from '@professor-connect/shared-types';

import { RemoteControlState } from './remote.types.js';

export const REMOTE_CONTROL_EVENTS = {
  request: EventType.REMOTE_REQUEST,
  accept: EventType.REMOTE_ACCEPT,
  deny: EventType.REMOTE_DENY,
  started: EventType.REMOTE_STARTED,
  stopped: EventType.REMOTE_STOPPED,
  command: EventType.REMOTE_COMMAND,
  expired: EventType.REMOTE_EXPIRED,
  failed: EventType.REMOTE_FAILED,
} as const;

const { IDLE, REQUESTED, AUTHORIZED, ACTIVE, STOPPING, STOPPED, DENIED, EXPIRED, FAILED } =
  RemoteControlState;

export const REMOTE_CONTROL_STATE_TRANSITIONS: readonly StateTransitionDefinition<RemoteControlState>[] =
  [
    { from: IDLE, to: REQUESTED },
    { from: STOPPED, to: REQUESTED },
    { from: DENIED, to: REQUESTED },
    { from: EXPIRED, to: REQUESTED },
    { from: FAILED, to: REQUESTED },
    { from: REQUESTED, to: AUTHORIZED },
    { from: REQUESTED, to: DENIED },
    { from: REQUESTED, to: EXPIRED },
    { from: REQUESTED, to: FAILED },
    { from: AUTHORIZED, to: ACTIVE },
    { from: AUTHORIZED, to: STOPPING },
    { from: AUTHORIZED, to: EXPIRED },
    { from: AUTHORIZED, to: FAILED },
    { from: ACTIVE, to: STOPPING },
    { from: ACTIVE, to: EXPIRED },
    { from: ACTIVE, to: FAILED },
    { from: STOPPING, to: STOPPED },
    { from: STOPPING, to: FAILED },
  ];
