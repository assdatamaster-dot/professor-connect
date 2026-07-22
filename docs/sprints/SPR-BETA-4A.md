# SPRINT BETA-4A — Integração inicial do WebRTC

## Arquitetura

O Socket.IO atua exclusivamente como servidor de sinalização. O backend não captura, processa
ou retransmite mídia: ele valida a sessão ativa e encaminha Offer, Answer e ICE Candidate somente
ao outro participante autenticado daquela sessão.

O professor inicia a negociação ao receber `session:started`. Os dois Electron mantêm uma
`RTCPeerConnection`, capturam câmera e microfone com `getUserMedia`, adicionam as tracks locais e
exibem as tracks remotas. A sinalização atravessa a ponte segura renderer → preload → main →
Socket.IO; nenhum acesso direto ao Node.js foi adicionado ao renderer.

Ao receber `session:ended`, os dois clientes fecham a `RTCPeerConnection`, param todas as
`MediaTrack`s e removem os streams dos elementos de vídeo, liberando câmera e microfone.

## Eventos Socket.IO

| Origem    | Evento                 | Destino   | Conteúdo principal          |
| --------- | ---------------------- | --------- | --------------------------- |
| professor | `webrtc:offer`         | aluno     | `sessionId` e `description` |
| aluno     | `webrtc:answer`        | professor | `sessionId` e `description` |
| ambos     | `webrtc:ice-candidate` | outro par | `sessionId` e `candidate`   |

Antes de encaminhar qualquer mensagem, o backend verifica que a sessão existe e está ativa, que
o socket remetente pertence à sessão e que o destinatário é o outro participante conectado. Os
logs emitidos são `Offer enviada`, `Answer enviada` e `ICE Candidate encaminhado`.

## Fluxo WebRTC

1. o professor aceita a solicitação e o backend cria a sessão ativa;
2. professor e aluno recebem `session:started`;
3. o professor abre a câmera e o microfone, cria a Offer e envia `webrtc:offer`;
4. o aluno aplica a Offer, abre seus dispositivos, cria a Answer e envia `webrtc:answer`;
5. o professor aplica a Answer;
6. ambos trocam ICE Candidates pelo backend e a mídia passa diretamente entre os pares;
7. `session:end` encerra a sessão e `session:ended` libera todos os recursos locais.

## Validação local

1. configure `apps/student-electron/config.json` e `apps/teacher-electron/config.json` com
   `http://localhost:3000`;
2. execute `npm run dev`;
3. abra o professor com `npm run desktop:teacher` e o aluno com `npm run desktop:student`;
4. permita o uso da câmera e do microfone nos dois aplicativos;
5. solicite atendimento pelo aluno e aceite pelo professor;
6. confirme vídeo local e remoto nos dois lados e valide o áudio usando fones para evitar eco;
7. encerre por um dos participantes e confirme que o indicador da câmera apaga nos dois lados;
8. confira no backend os logs de Offer, Answer e ICE;
9. execute `npm run test`, `npm run build` e `npx turbo run build`.

## Homologação no EasyPanel

Use a configuração existente em `docs/deploy/easypanel.md`: contexto na raiz, Dockerfile em
`services/backend/Dockerfile`, porta interna `3000`, HTTPS habilitado, proxy com suporte a
WebSocket e uma única réplica. Não há nova porta de mídia no backend, porque o tráfego WebRTC é
direto entre professor e aluno.

Após o deploy, aponte os dois Electron para o domínio HTTPS, repita o fluxo completo e confira os
logs de sinalização. O STUN público configurado atende cenários comuns; redes corporativas ou NAT
simétrico podem exigir um servidor TURN em uma sprint de infraestrutura para garantir a conexão
de mídia. Enquanto sessões e presença estiverem em memória, mantenha uma única réplica.
