export const TEACHER_IPC_CHANNELS = {
  INITIALIZE: 'teacher:workflow:initialize',
  ACCEPT_REQUEST: 'teacher:workflow:accept-request',
  REJECT_REQUEST: 'teacher:workflow:reject-request',
  REQUEST_SCREEN_SHARING: 'teacher:workflow:request-screen-sharing',
  REQUEST_REMOTE_CONTROL: 'teacher:workflow:request-remote-control',
  END_ATTENDANCE: 'teacher:workflow:end-attendance',
  STATE_CHANGED: 'teacher:workflow:state-changed',
} as const;
