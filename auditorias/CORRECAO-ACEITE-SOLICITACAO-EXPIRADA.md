# Correção — aceite de solicitação expirada

Data: 27/07/2026

## Sintoma

Depois de clicar em **Aceitar**, o diálogo desaparecia e o aplicativo do
professor voltava ao painel online sem abrir o atendimento.

## Causa confirmada

O backend de produção mostrou a última solicitação de `Anderson` com estado
`expired`, criada às 21:43:26 UTC. Não havia solicitação pendente.

Três comportamentos combinados produziam o sintoma:

1. a solicitação expirava após 30 segundos;
2. o backend notificava o timeout somente ao aluno;
3. o cliente do professor removia a solicitação imediatamente ao emitir
   `session:accept`, antes de receber `session:started`.

Quando o professor aceitava o pedido já expirado, o backend descartava o erro
apenas no log. A interface já havia removido o pedido e voltava ao painel
online.

## Correção

- O backend agora envia `session:timeout` ao professor e ao aluno.
- O professor mantém a solicitação visível depois do clique em **Aceitar**.
- A solicitação só é removida quando chega a confirmação `session:started`.
- Foi adicionado um timeout local de segurança para funcionar também com a
  versão anterior do backend.
- Ao expirar, a interface mostra:
  `A solicitação expirou. Peça ao aluno para enviar novamente.`
- Erros IPC do botão **Aceitar** passam a ser apresentados na interface.

## Arquivos alterados

- `services/backend/websocket/src/modules/session-request/session-request.gateway.ts`
- `services/backend/websocket/tests/session-request-flow.spec.ts`
- `apps/teacher-electron/main/professor-presence.controller.ts`
- `apps/teacher-electron/shared/presence-contracts.ts`
- `apps/teacher-electron/renderer/presence.html`
- `apps/teacher-electron/renderer/presence.ts`
- `apps/teacher-electron/tests/professor-presence.spec.ts`

As correções anteriores de transmissão de tela e controle remoto foram
preservadas.

## Validação

- Pedido válido permanece pendente até `session:started`.
- Pedido expirado é removido após notificação do backend.
- Fallback local remove pedido expirado mesmo com backend antigo.
- Timeout entregue ao professor e ao aluno.
- Sessão real criada contra o backend de produção atual.
- 7/7 amostras do smoke test com professor e aluno em controle remoto `active`.
- 11/11 tarefas de teste do monorepo aprovadas.
- 13/13 tarefas de typecheck aprovadas.
- 13/13 tarefas de lint aprovadas.
- Build do backend aprovado.
- Build e empacotamento do professor aprovados.

Evidência do smoke test:
`auditorias/session-accept-smoke.json`

## Executável

- Arquivo:
  `release/teacher/Professor-Connect-Professor-Setup-0.1.0-x64.exe`
- Tamanho: 99.942.260 bytes
- SHA-256:
  `A4E6AC01623BAAECF7613D97781D4DCFFBB5E357416B3246AA0F07902F91B6F4`
- Assinatura Authenticode: `NotSigned`

O instalador contém o fallback local e corrige o comportamento mesmo antes da
próxima publicação do backend. A alteração do backend também está pronta e
validada para o próximo deploy.
