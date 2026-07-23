export interface RemoteControlPermissionFlow<TSnapshot> {
  isScreenSharing(): boolean;
  startScreenShare(): Promise<void>;
  approveRemoteControl(): Promise<TSnapshot>;
}

export async function approveRemoteControlWithScreen<TSnapshot>(
  flow: RemoteControlPermissionFlow<TSnapshot>,
): Promise<TSnapshot> {
  if (!flow.isScreenSharing()) {
    await flow.startScreenShare();
  }
  if (!flow.isScreenSharing()) {
    throw new Error(
      'Não foi possível compartilhar todos os monitores antes de permitir o controle remoto.',
    );
  }
  return flow.approveRemoteControl();
}
