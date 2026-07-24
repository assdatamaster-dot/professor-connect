import type { RemoteControlRequest } from '@professor-connect/protocol';

export class InputPermissions {
  private activeReference: RemoteControlRequest | undefined;

  public grant(reference: RemoteControlRequest): void {
    if (this.activeReference !== undefined) {
      throw new Error('Já existe uma autorização de entrada remota ativa');
    }
    this.activeReference = { ...reference };
  }

  public require(reference: RemoteControlRequest): RemoteControlRequest {
    const active = this.activeReference;
    if (
      active === undefined ||
      active.sessionId !== reference.sessionId ||
      active.requestId !== reference.requestId
    ) {
      throw new Error('Evento de entrada recebido sem autorização ativa');
    }
    return active;
  }

  public revoke(): void {
    this.activeReference = undefined;
  }

  public isActive(): boolean {
    return this.activeReference !== undefined;
  }
}
