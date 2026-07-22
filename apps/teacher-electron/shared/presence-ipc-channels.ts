export const PRESENCE_IPC_CHANNELS = {
  CONNECT: 'teacher:presence:connect',
  DISCONNECT: 'teacher:presence:disconnect',
  GET_STATE: 'teacher:presence:get-state',
  STATE_CHANGED: 'teacher:presence:state-changed',
} as const;
