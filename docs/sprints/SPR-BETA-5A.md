# Sprint Beta-5A — Infraestrutura do Canal de Controle Remoto

## Escopo

Esta sprint implementa somente autorização, transporte e observabilidade dos eventos de controle
remoto. Nenhum evento recebido é convertido em ação do sistema operacional. Não existem chamadas
para automação, injeção de mouse, injeção de teclado ou APIs nativas de controle.

PresenceManager, SessionManager, SessionRequestManager, MediaDeviceManager, WebRTC,
compartilhamento de tela e a infraestrutura de implantação permanecem no fluxo existente.

## Arquitetura

O canal usa eventos dedicados no mesmo socket Socket.IO já autenticado pelo registro de presença.
Isso evita uma segunda identidade/conexão e permite que o backend valide a sessão ativa e o papel do
remetente antes de encaminhar cada payload.

```text
Professor renderer
  RemoteControlClient
        │ IPC validado
        ▼
ProfessorPresenceController ── Socket.IO ── RemoteControlGateway
                                               │
                                               │ sessão + papel + autorização
                                               ▼
StudentPresenceController ── RemoteControlReceiver ── logs/interface
```

Componentes:

- `RemoteControlGateway`: mantém autorização pendente/ativa por sessão, valida os participantes e
  encaminha somente ao outro participante;
- `RemoteControlClient`: captura `mousemove`, `mousedown`, `mouseup`, `wheel`, `keydown` e `keyup`,
  normaliza coordenadas e envia pelo transporte IPC/Socket.IO;
- `RemoteControlReceiver`: recebe e registra os eventos. O módulo não possui porta, callback ou
  dependência capaz de executá-los;
- `SessionManager`: informa o papel do participante na rota e notifica o encerramento da sessão para
  revogação automática.

## Eventos

| Evento                    | Origem    | Destino   | Pré-condição            |
| ------------------------- | --------- | --------- | ----------------------- |
| `remote-control:request`  | Professor | Aluno     | Sessão ativa            |
| `remote-control:approved` | Aluno     | Professor | Solicitação pendente    |
| `remote-control:denied`   | Aluno     | Professor | Solicitação pendente    |
| `remote-control:mouse`    | Professor | Aluno     | Autorização ativa       |
| `remote-control:keyboard` | Professor | Aluno     | Autorização ativa       |
| `remote-control:stop`     | Ambos     | Outro     | Solicitação reconhecida |

O gateway rejeita payloads inválidos, participantes externos, papéis invertidos, eventos anteriores
ao aceite e referências de autorização divergentes.

## Fluxo de autorização

1. O professor seleciona **Solicitar Controle** durante uma sessão ativa.
2. O servidor registra a solicitação como pendente e a encaminha somente ao aluno da sessão.
3. O aluno recebe a janela “O professor deseja controlar seu computador.”.
4. **Permitir** ativa a autorização no aluno e envia `remote-control:approved`.
5. Somente após o professor receber o aceite o `RemoteControlClient` começa a capturar eventos.
6. **Negar** remove a solicitação; nenhum capturador é ativado.
7. Qualquer participante pode encerrar o canal. O término do atendimento também emite
   `remote-control:stop` para ambos e remove a autorização no backend.

## Fluxo dos eventos

Eventos de ponteiro usam coordenadas normalizadas entre 0 e 1, botão e máscara de botões. Eventos de
roda incluem deltas e modo. Eventos de teclado incluem tipo, tecla, código, repetição e modificadores.
O gateway aplica limites de tipo, tamanho e faixa antes do encaminhamento.

No aluno, os registros visíveis são:

- `MouseMove`;
- `Click (mousedown)` e `Click (mouseup)`;
- `Wheel`;
- `KeyDown`;
- `KeyUp`.

## Logs

São registrados os marcos:

- Solicitação enviada;
- Solicitação aceita;
- Solicitação negada;
- Evento recebido;
- Controle encerrado.

O aluno mantém no máximo 100 entradas do canal e as combina com o painel de atividade existente.

## Evidências automatizadas

- teste do gateway com professor, aluno e participante externo;
- bloqueio de mouse antes do aceite;
- bloqueio de mouse enviado pelo papel aluno;
- aceite, recusa, transporte de mouse/teclado e stop;
- revogação automática ao encerrar a sessão;
- captura dos seis eventos pelo `RemoteControlClient`;
- registro dos cinco tipos de log pelo `RemoteControlReceiver`;
- teste explícito de evento recebido sem autorização;
- ausência de qualquer executor no contrato do receiver.

## Compatibilidade

Não foram adicionadas portas, rotas HTTP, volumes, variáveis de ambiente ou serviços. O canal usa a
conexão Socket.IO existente, sem alterar a topologia de Docker ou EasyPanel. A indentação já
inválida do item `expose` no Compose de produção foi corrigida para que o YAML volte a ser
analisável.
