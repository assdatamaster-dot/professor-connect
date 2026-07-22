export const SESSION_IPC_CHANNELS = {
  GET_TEACHERS: 'student:session:get-teachers',
  REQUEST: 'student:session:request',
  GET_STATE: 'student:session:get-state',
  END: 'student:session:end',
  STATE_CHANGED: 'student:session:state-changed',
  WEBRTC_SEND_ANSWER: 'student:webrtc:send-answer',
  WEBRTC_SEND_ICE: 'student:webrtc:send-ice-candidate',
  WEBRTC_OFFER: 'student:webrtc:offer',
  WEBRTC_ICE: 'student:webrtc:ice-candidate',
} as const;
