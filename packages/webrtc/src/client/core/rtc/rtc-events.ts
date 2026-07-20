export enum RtcEventType {
  LOCAL_STREAM_CREATED = 'rtc.local-stream-created',
  REMOTE_STREAM_RECEIVED = 'rtc.remote-stream-received',
  PEER_CONNECTED = 'rtc.peer-connected',
  RECONNECTING = 'rtc.reconnecting',
  RECONNECTED = 'rtc.reconnected',
  CLOSED = 'rtc.closed',
  FAILED = 'rtc.failed',
}
