import type { AttendanceSession, SessionConnectionState } from './session.types.js';

export class ConnectionHealthMonitor {
  public transition(
    session: AttendanceSession,
    nextState: SessionConnectionState,
    now: Date,
  ): Pick<
    AttendanceSession,
    'connectionState' | 'stateUpdatedAt' | 'connectedMilliseconds' | 'reconnectingMilliseconds'
  > {
    const elapsed = Math.max(
      0,
      now.getTime() - Date.parse(session.stateUpdatedAt ?? session.createdAt),
    );
    return {
      connectionState: nextState,
      stateUpdatedAt: now.toISOString(),
      connectedMilliseconds:
        (session.connectedMilliseconds ?? 0) +
        (session.connectionState === 'CONNECTED' ? elapsed : 0),
      reconnectingMilliseconds:
        (session.reconnectingMilliseconds ?? 0) +
        (session.connectionState === 'RECONNECTING' || session.connectionState === 'RECOVERING'
          ? elapsed
          : 0),
    };
  }
}
