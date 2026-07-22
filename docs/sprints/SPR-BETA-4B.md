# SPRINT BETA-4B — Compartilhamento de tela

## Arquitetura

O compartilhamento usa a `RTCPeerConnection` criada no Beta-4A. O aluno captura somente vídeo
com `navigator.mediaDevices.getDisplayMedia`, adiciona a track de tela sem substituir as tracks da
câmera e do microfone e renegocia a conexão existente.

A sinalização WebRTC continua trafegando pelo Socket.IO, sem processamento de mídia no backend.
Os eventos `screen-share:start` e `screen-share:stop` apenas sincronizam a interface do professor;
ambos são validados contra a sessão ativa e encaminhados exclusivamente ao outro participante.

## Fluxo

1. durante uma sessão ativa, o aluno seleciona **Compartilhar Tela**;
2. o Electron abre o seletor nativo de janela ou monitor;
3. a track capturada é adicionada à conexão existente;
4. o aluno emite `screen-share:start` e uma nova `webrtc:offer`;
5. o professor aplica a Offer, responde com `webrtc:answer` e exibe a nova track;
6. a interface do professor mantém simultaneamente Tela Compartilhada, Vídeo do Aluno e Vídeo do
   Professor;
7. ao selecionar **Parar Compartilhamento** ou usar o controle do sistema operacional, o aluno
   remove e encerra a track, emite `screen-share:stop` e renegocia a conexão;
8. o encerramento da sessão continua liberando câmera, microfone, tela e PeerConnection.

## Validação local

1. configure os dois Electron para `http://localhost:3000`;
2. execute `npm run dev`;
3. abra professor e aluno, solicite atendimento e aceite;
4. confirme os vídeos local e remoto nos dois aplicativos;
5. no aluno, selecione **Compartilhar Tela** e escolha uma janela ou monitor;
6. confirme que o professor exibe os três visores e que câmera e áudio continuam ativos;
7. selecione **Parar Compartilhamento** e confirme que somente a tela desaparece;
8. repita e interrompa pelo controle de compartilhamento do Windows;
9. encerre a sessão e confirme que todos os indicadores de captura são desligados;
10. execute `npm run test`, `npm run build` e `npx turbo run build`.

## Homologação no EasyPanel

Faça o redeploy do backend antes de testar os novos executáveis. Preserve o Dockerfile, a porta
interna `3000`, HTTPS, proxy WebSocket e uma única réplica. Os novos eventos usam a mesma conexão
Socket.IO e não exigem portas adicionais.

Depois do deploy, aponte ambos os Electron para o domínio HTTPS e repita o roteiro em duas
máquinas. O compartilhamento é mídia WebRTC direta; em redes com NAT restritivo, a disponibilidade
continua dependendo de TURN.
