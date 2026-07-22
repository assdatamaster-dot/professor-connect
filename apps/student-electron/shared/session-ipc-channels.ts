export const SESSION_IPC_CHANNELS = {
  GET_TEACHERS: 'student:session:get-teachers',
  REQUEST: 'student:session:request',
  GET_STATE: 'student:session:get-state',
  END: 'student:session:end',
  STATE_CHANGED: 'student:session:state-changed',
} as const;
