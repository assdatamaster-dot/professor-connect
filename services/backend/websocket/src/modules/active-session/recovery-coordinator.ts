import type { SessionManager } from './session.manager.js';
import type { SessionDelivery } from './session.types.js';

export class RecoveryCoordinator {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  public constructor(private readonly manager: SessionManager) {}

  public schedule(sessionId: string, onExpired: (delivery: SessionDelivery) => void): void {
    this.clear(sessionId);
    const deadline = this.manager.findSession(sessionId)?.recoveryDeadline;
    if (deadline === undefined) return;
    const timer = setTimeout(
      () => {
        this.timers.delete(sessionId);
        const delivery = this.manager.expireRecovery(sessionId);
        if (delivery !== undefined) onExpired(delivery);
      },
      Math.max(0, Date.parse(deadline) - Date.now()),
    );
    timer.unref?.();
    this.timers.set(sessionId, timer);
  }

  public clear(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(sessionId);
  }

  public dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
