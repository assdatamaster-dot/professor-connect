export const PRESENCE_IPC_CHANNELS = {
  CONNECT: 'teacher:presence:connect',
  DISCONNECT: 'teacher:presence:disconnect',
  GET_STATE: 'teacher:presence:get-state',
  ACCEPT_SESSION: 'teacher:presence:accept-session',
  REJECT_SESSION: 'teacher:presence:reject-session',
  END_SESSION: 'teacher:presence:end-session',
  STATE_CHANGED: 'teacher:presence:state-changed',
} as const;
