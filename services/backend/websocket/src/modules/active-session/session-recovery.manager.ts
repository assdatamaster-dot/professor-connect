import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { AttendanceSession, SessionParticipantRole } from './session.types.js';

export interface RecoveryCredentials {
  readonly token: string;
  readonly tokenHash: string;
}

/** Creates opaque recovery credentials and never persists their plaintext form. */
export class SessionRecoveryManager {
  public issueCredentials(): RecoveryCredentials {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: this.hashToken(token) };
  }

  public verifyToken(
    session: AttendanceSession,
    role: SessionParticipantRole,
    token: string,
  ): boolean {
    const expected =
      role === 'teacher' ? session.teacherRecoveryTokenHash : session.studentRecoveryTokenHash;
    if (expected === undefined || token.length < 32 || token.length > 256) return false;
    const actualBuffer = Buffer.from(this.hashToken(token), 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return (
      actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }

  public hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
