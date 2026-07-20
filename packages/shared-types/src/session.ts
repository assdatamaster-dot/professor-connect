export enum SessionStatus {
  WAITING = 'WAITING',
  ACTIVE = 'ACTIVE',
  FINISHED = 'FINISHED',
}

export interface Session {
  readonly id: string;
  readonly clientIds: readonly string[];
  readonly status: SessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type SessionCreatePayload = Record<never, never>;

export interface SessionCreatedPayload {
  readonly session: Session;
}

export type SessionJoinPayload = Record<never, never>;
export type SessionLeavePayload = Record<never, never>;
export type SessionClosePayload = Record<never, never>;

export interface SessionClosedPayload {
  readonly session: Session;
}
