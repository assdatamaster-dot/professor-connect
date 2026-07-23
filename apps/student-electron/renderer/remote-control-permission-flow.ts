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
      'Selecione uma tela inteira para compartilhar antes de permitir o controle remoto.',
    );
  }
  return flow.approveRemoteControl();
}
