# SPR-BETA-4C — Gerenciamento Inteligente de Dispositivos de Mídia

## Resultado

A captura de câmera, microfone e tela deixou de ser iniciada como um único bloco. Os três
recursos agora têm controladores, estados e ciclos de vida independentes, compartilhados pelos
clientes Electron por meio do `MediaDeviceManager`.

Os contratos existentes de Presence, Session, Socket.IO, REST e sinalização WebRTC não foram
alterados.

## Arquitetura

O módulo está em `packages/engine/src/client/core/media-devices`:

- `MediaDeviceManager`: inicialização, inventário, `devicechange`, snapshot e eventos.
- `CameraController`: permissão, stream, encerramento e estados da câmera.
- `MicrophoneController`: permissão, stream, mute e estados do microfone.
- `ScreenShareController`: seleção, stream, encerramento manual/nativo e estados da tela.
- `DeviceStatus`: estados públicos, mensagens amigáveis e indicadores visuais.
- `BrowserMediaDevicesAdapter`: fronteira única com `navigator.mediaDevices`.

Os renderers consomem snapshots e cuidam apenas da apresentação e da integração das tracks com
a conexão WebRTC. A captura e a classificação de erros não ficam mais na interface.

## Fluxos de estado

### Câmera

```text
inicialização
  ├─ dispositivo encontrado → CAMERA_AVAILABLE
  │    ├─ permissão concedida → CAMERA_ACTIVE
  │    ├─ usuário desliga → CAMERA_DISABLED
  │    ├─ permissão negada → CAMERA_PERMISSION_DENIED
  │    └─ falha de captura → CAMERA_ERROR
  └─ dispositivo ausente/removido → CAMERA_NOT_FOUND
```

Ao entrar em `CAMERA_ACTIVE`, somente a track de vídeo é adicionada. Ao sair desse estado,
somente o sender da câmera é removido e a conexão é renegociada sem encerrar a sessão.

### Microfone

```text
inicialização
  ├─ dispositivo encontrado → MIC_MUTED
  │    ├─ permissão concedida → MIC_ACTIVE
  │    ├─ usuário muta → MIC_MUTED
  │    ├─ permissão negada → MIC_PERMISSION_DENIED
  │    └─ falha de captura → MIC_ERROR
  └─ dispositivo ausente/removido → MIC_NOT_FOUND
```

O sender de áudio é independente do sender de vídeo. A indisponibilidade da câmera não impede
o microfone de ser capturado.

### Compartilhamento de tela

```text
SCREEN_IDLE
  ├─ seleção confirmada → SCREEN_SHARING
  │    ├─ usuário encerra → SCREEN_STOPPED
  │    └─ seletor nativo encerra → SCREEN_STOPPED
  ├─ permissão negada/cancelamento → SCREEN_PERMISSION_DENIED
  └─ falha de captura → SCREEN_ERROR
```

A track de tela usa sender próprio e não substitui a câmera. Seu encerramento remove apenas esse
sender, preservando câmera, microfone e sessão.

## UX

- Painéis independentes apresentam mensagem, indicador e ação para cada recurso.
- Verde indica ativo; vermelho, desligado; amarelo, solicitação em andamento; cinza,
  dispositivo inexistente.
- Câmera local e vídeo remoto têm placeholders com explicação e orientação.
- A interface do professor também diferencia vídeo local, vídeo remoto e tela recebida.
- Erros técnicos de `enumerateDevices`, `getUserMedia` e `getDisplayMedia` são convertidos em
  mensagens de domínio.

## Atualização dinâmica

O manager registra um listener de `devicechange` durante `initialize()`. Cada alteração refaz o
inventário, atualiza apenas o controlador afetado e publica um novo snapshot. A remoção de um
dispositivo ativo encerra somente sua stream.

## Validação executada

- `npm run lint`: 13 pacotes.
- `npm run typecheck`: 13 pacotes.
- `npm run test`: todas as suítes do monorepo.
- `npm run build`: 13 pacotes.
- `npx turbo run build`: 13 pacotes.
- Testes novos do manager:
  - conexão dinâmica de microfone;
  - câmera negada sem bloquear microfone ou tela;
  - remoção isolada de câmera;
  - encerramento nativo do compartilhamento;
  - falha de enumeração com mensagem amigável.

## Melhorias futuras

- Persistir a escolha entre múltiplas câmeras e microfones.
- Exibir medidor de nível e teste de microfone antes da sessão.
- Adicionar política de resolução/FPS por qualidade da rede.
- Implementar o padrão WebRTC de perfect negotiation para mudanças simultâneas nos dois pares.
- Acrescentar testes end-to-end com dispositivos virtuais no pipeline de CI.
