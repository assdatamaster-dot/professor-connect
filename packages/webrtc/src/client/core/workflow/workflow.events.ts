import type { StateTransitionDefinition } from '@professor-connect/services/state-machine';

import { WorkflowState } from './workflow.types.js';

export enum WorkflowEventType {
  ATTENDANCE_STARTED = 'workflow.attendance-started',
  REQUEST_CREATED = 'workflow.request-created',
  REQUEST_ACCEPTED = 'workflow.request-accepted',
  SESSION_CREATED = 'workflow.session-created',
  CALL_CREATED = 'workflow.call-created',
  SIGNALING_STARTED = 'workflow.signaling-started',
  WEBRTC_CONNECTED = 'workflow.webrtc-connected',
  DATA_CHANNEL_CONNECTED = 'workflow.data-channel-connected',
  MEDIA_STARTED = 'workflow.media-started',
  SCREEN_SHARING_STARTED = 'workflow.screen-sharing-started',
  REMOTE_CONTROL_AUTHORIZED = 'workflow.remote-control-authorized',
  CONNECTION_LOST = 'workflow.connection-lost',
  RECOVERED = 'workflow.recovered',
  ATTENDANCE_FINISHED = 'workflow.attendance-finished',
  RESOURCES_RELEASED = 'workflow.resources-released',
  FAILED = 'workflow.failed',
}

const {
  IDLE,
  CONNECTING,
  REQUESTED,
  PREPARING,
  NEGOTIATING,
  ACTIVE,
  RECOVERING,
  STOPPING,
  COMPLETED,
  FAILED,
} = WorkflowState;

export const WORKFLOW_STATE_TRANSITIONS: readonly StateTransitionDefinition<WorkflowState>[] = [
  { from: IDLE, to: CONNECTING },
  { from: COMPLETED, to: CONNECTING },
  { from: FAILED, to: CONNECTING },
  { from: CONNECTING, to: REQUESTED },
  { from: REQUESTED, to: PREPARING },
  { from: PREPARING, to: NEGOTIATING },
  { from: NEGOTIATING, to: ACTIVE },
  { from: ACTIVE, to: RECOVERING },
  { from: RECOVERING, to: ACTIVE },
  { from: ACTIVE, to: STOPPING },
  { from: STOPPING, to: COMPLETED },
  { from: STOPPING, to: FAILED },
  { from: CONNECTING, to: FAILED },
  { from: REQUESTED, to: FAILED },
  { from: PREPARING, to: FAILED },
  { from: NEGOTIATING, to: FAILED },
  { from: ACTIVE, to: FAILED },
  { from: RECOVERING, to: FAILED },
];
