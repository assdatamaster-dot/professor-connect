# Sprint Beta-8A — Auditoria e planejamento de UX/UI

## Escopo e método

Esta auditoria foi concluída antes da implementação. Foram inspecionadas as superfícies ativas do professor (`presence.html`, `presence.css`, `presence.ts`) e do aluno (`index.html`, `styles.css`, `index.ts`), seus estados de sessão, permissões, mídia, controle remoto e transferência de arquivos. Também foram verificados os contratos entre DOM e renderer para preservar IDs, eventos, IPC, WebRTC e Socket.IO.

O escopo da implementação será exclusivamente o renderer: estrutura semântica, design system, apresentação e microinterações. Backend, protocolos, WebRTC, Socket.IO, IPC e ciclo de vida das janelas permanecem inalterados.

## 1. Auditoria da experiência atual

### Fluxo e arquitetura de informação

1. **A infraestrutura aparece antes da tarefa do usuário.** Status de servidor, logs, nomes internos como “Canal P2P” e referência “Beta-5C” ganham espaço permanente. Isso faz professor e aluno interpretarem o sistema antes de conseguirem agir.
2. **A jornada não é representada como estados claros.** Espera, chamada, atendimento, compartilhamento e controle são blocos adicionados à mesma página, sem uma mudança de foco visual coerente.
3. **O painel de atividade do aluno ocupa uma coluna permanente.** Logs técnicos competem com a solicitação de ajuda e aumentam a carga cognitiva; são informação secundária e episódica.
4. **A experiência do professor começa como um formulário genérico.** O login não comunica prontidão, segurança ou o propósito educacional do produto.
5. **A experiência em espera do professor é passiva e pouco orientadora.** Não há um estado vazio forte dizendo que o professor está disponível e que as solicitações chegarão automaticamente.
6. **Funcionalidades progressivas são expostas cedo demais.** Compartilhamento, controle remoto e transferência aparecem como painéis completos, mesmo quando não são o próximo passo natural.

### Hierarquia visual e layout

7. **Vídeo do aluno e vídeo do professor têm peso equivalente no atendimento do professor.** Isso contradiz a prioridade da conversa centrada no aluno.
8. **Ao compartilhar tela, a composição cresce em uma grade em vez de trocar a hierarquia.** A tela deveria se tornar o palco principal e as webcams deveriam virar overlays compactos.
9. **Controle remoto ocupa um painel grande e técnico.** Ativá-lo não deveria mudar de contexto; basta um estado persistente, inequívoco e um controle de interrupção.
10. **Transferência de arquivos forma um bloco visual pesado.** Trata-se de uma ação de apoio e deve permanecer recolhida até que o canal esteja disponível ou haja transferências.
11. **Cards aninhados em excesso fragmentam a leitura.** Superfície dentro de superfície cria muitos contornos, dilui o foco e faz o produto parecer um painel administrativo.
12. **Alturas mínimas fixas e conteúdo cumulativo podem exigir rolagem em 1366×768.** Isso prejudica justamente as resoluções explicitamente priorizadas.
13. **A largura de leitura varia sem um grid comum.** Professor e aluno usam escalas, raios e espaçamentos semelhantes, mas não sistematizados.

### Tipografia, linguagem e consistência

14. **Há excesso de caixa alta e etiquetas técnicas.** “STATUS DO ATENDIMENTO”, “DISPOSITIVOS” e “CANAL P2P PROTEGIDO” aumentam ruído e soam como interface de diagnóstico.
15. **Rótulos são inconsistentes.** “Ligar”, “Ativar”, “Compartilhar Todas as Telas”, “Solicitar Controle” e “Controle Remoto Inativo” não seguem uma gramática uniforme.
16. **Emojis são usados como ícones funcionais e status.** A aparência varia por sistema operacional, prejudica consistência e pode duplicar informação para tecnologias assistivas.
17. **Textos internos vazam para o usuário.** “Beta-5C” é linguagem de desenvolvimento, não uma explicação orientada à segurança ou ao benefício.
18. **Professor e aluno parecem produtos relacionados, mas não o mesmo produto.** Tokens, componentes e comportamento visual foram duplicados com pequenas divergências.

### Acessibilidade

19. **Estados dependem parcialmente de cor e emoji.** Pontos vermelho/verde precisam estar acompanhados de texto consistente e sem pictogramas redundantes.
20. **Alguns textos auxiliares usam tamanhos entre 0,58 e 0,68 rem.** Isso reduz legibilidade em notebooks e em escalas de exibição elevadas.
21. **Foco visível não é padronizado em todos os controles.** Inputs, selects, botões e `summary` precisam compartilhar um anel de foco de alto contraste.
22. **Diálogos explicam permissões em blocos densos.** A decisão principal e o que será permitido precisam ser escaneáveis.
23. **A atividade técnica usa regiões `aria-live` permanentes.** Atualizações numerosas podem distrair leitores de tela; o histórico deve ser secundário e recolhível.

### Performance visual e escalabilidade

24. **Gradientes, sombras e `backdrop-filter` são aplicados a áreas amplas.** Apesar de moderados, podem ser concentrados em superfícies menores para reduzir custo de composição.
25. **A interface cresce por adição vertical de painéis.** Novas capacidades tenderiam a produzir mais rolagem e mais competição visual.
26. **Seletores e componentes não seguem um vocabulário compartilhado.** Isso aumenta o custo de evolução e facilita divergências entre os aplicativos.

## 2. Problemas prioritários

Os cinco problemas de maior impacto são:

1. comunicação sem protagonismo visual;
2. recursos auxiliares expostos antes do contexto;
3. tela compartilhada sem promoção automática a palco principal;
4. logs e detalhes técnicos competindo com a tarefa;
5. ausência de um design system coerente entre professor e aluno.

## 3. Nova filosofia de UX

O Professor Connect será tratado como uma **sala de atendimento educacional**, não como um console de acesso remoto.

- **Uma ação principal por estado:** entrar, pedir ajuda, aceitar chamada, conversar, autorizar ou encerrar.
- **Comunicação primeiro:** o palco de vídeo ocupa a maior área disponível.
- **Divulgação progressiva:** tela, controle, arquivos e atividade aparecem quando necessários.
- **Confiança por linguagem clara:** explicar pessoas, efeitos e possibilidade de interromper; ocultar nomes de infraestrutura.
- **Continuidade espacial:** compartilhar ou controlar não abre uma nova experiência, apenas muda o estado do mesmo palco.

## 4. Arquitetura visual proposta

### Professor

**Entrada**

- painel de marca e propósito;
- formulário curto, com label explícita e CTA claro;
- indicação de sessão segura sem jargão.

**Disponível**

- barra superior compacta com identidade, presença e saída;
- mensagem principal “Pronto para atender”;
- prontidão de câmera e microfone em controles compactos;
- estado vazio explicando que chamadas surgirão automaticamente.

**Chamada recebida**

- diálogo de alta prioridade com nome do aluno;
- “Aceitar atendimento” como ação primária e “Agora não” como secundária;
- foco preso pelo elemento `dialog` nativo.

**Atendimento**

- palco escuro como superfície principal;
- webcam do aluno em destaque;
- webcam do professor em picture-in-picture;
- controles de mídia compactos abaixo do palco;
- ações de apoio agrupadas em uma faixa discreta;
- encerramento separado visualmente das ações reversíveis.

**Compartilhamento**

- tela compartilhada promovida automaticamente a conteúdo principal;
- vídeo do aluno e do professor mantidos como overlays;
- nenhuma navegação ou janela adicional.

**Controle remoto**

- mesma composição do compartilhamento;
- indicador persistente “Controle ativo” junto ao palco;
- ação imediata “Parar controle”;
- histórico técnico recolhido em `details`.

### Aluno

**Disponível**

- cabeçalho compacto;
- mensagem direta “Como podemos ajudar?”;
- seleção de professor e CTA único;
- checagem de câmera/microfone em segundo plano visual.

**Aguardando**

- o mesmo card muda seu estado por texto, sem introduzir novos painéis.

**Atendimento**

- vídeo do professor como palco principal;
- vídeo do aluno em picture-in-picture;
- câmera e microfone como controles compactos;
- encerramento sempre disponível e distinto.

**Pedidos de permissão**

- diálogo com ação solicitada, pessoa solicitante, capacidades e garantia de interrupção;
- “Permitir controle” como ação explícita e “Não permitir” como alternativa clara.

**Atividade e arquivos**

- histórico em disclosure recolhido;
- transferência visível somente quando o canal da sessão estiver disponível.

## 5. Design system planejado

### Fundação

- fonte: pilha nativa `Inter`/`Segoe UI`, sem download ou custo adicional;
- escala de 4 px, com espaçamentos principais de 8, 12, 16, 24 e 32 px;
- raios de 10, 14, 18 e 24 px;
- superfícies clara, elevada, sutil e palco;
- azul-índigo para ação, teal para presença, âmbar para espera e vermelho para ação destrutiva;
- sombras apenas em superfícies elevadas e diálogos.

### Componentes

- `app-bar`, `brand-lockup`, `status-pill`;
- `hero-state`, `empty-state`;
- `media-stage`, `video-tile`, `picture-in-picture`;
- `device-control`, `icon-button`, `button` primário/secundário/perigo;
- `support-actions`, `permission-dialog`;
- `disclosure-panel` para detalhes, atividade e arquivos;
- indicadores com texto e forma, nunca somente cor.

### Estados e movimento

- hover e active entre 120–180 ms;
- transições restritas a cor, borda, opacidade e transformação curta;
- respeito integral a `prefers-reduced-motion`;
- sem animações contínuas;
- foco visível de 3 px em todos os elementos interativos.

## 6. Estratégia de implementação

1. preservar todos os IDs consumidos pelos renderers;
2. reorganizar apenas HTML e CSS das superfícies ativas;
3. usar SVG inline leve para ícones estáveis e acessíveis;
4. remover emojis e texto de versão da apresentação;
5. manter vídeos montados no mesmo DOM para não interromper streams;
6. usar os atributos `hidden` já controlados pelo renderer para alternar estados;
7. usar `:has()` apenas como melhoria visual de layout, nunca para funcionalidade;
8. não adicionar bibliotecas, fontes remotas, imagens pesadas ou listeners;
9. validar build, lint, typecheck, testes e as resoluções-alvo.

## 7. Critérios de aceitação visual

- em 1366×768, o atendimento exibe palco e controles essenciais sem rolagem da janela;
- aluno e professor compartilham tokens, componentes e linguagem;
- vídeo/tela ocupam mais área que controles ou diagnóstico;
- todas as ações principais são alcançáveis por teclado e têm foco visível;
- nenhuma capacidade técnica é removida;
- o estado do controle remoto é inequívoco e pode ser interrompido;
- com movimento reduzido, a interface permanece totalmente utilizável;
- não há alteração de backend, WebRTC, Socket.IO, IPC ou contratos.

---

## 8. Relatório de implementação

### 8.1 Resultado entregue

O redesign transforma as duas superfícies ativas em uma sala de atendimento orientada por contexto. A interface inicial prioriza disponibilidade e chamada; a interface ativa prioriza o palco de comunicação; recursos auxiliares aparecem de forma progressiva e sem trocar de tela.

Não foram adicionadas funcionalidades. Backend, WebRTC, Socket.IO, IPC, controle remoto, transferência de arquivos e arquitetura das sessões não foram alterados.

### 8.2 Componentes criados

- **App bar unificada:** identidade, contexto da aplicação, presença e perfil.
- **Login institucional do professor:** propósito do produto, confiança e formulário simples.
- **Waiting hero:** estado vazio útil para o professor disponível.
- **Call composer:** seleção de professor e solicitação como única ação principal do aluno.
- **Media stage:** palco escuro e responsivo para vídeo e compartilhamento.
- **Picture-in-picture:** vídeo local sobreposto; no compartilhamento do professor, ambas as webcams viram overlays.
- **Device controls:** câmera, microfone e tela em controles compactos com estado textual.
- **Support bar:** controle remoto, arquivos e encerramento agrupados sem competir com o palco.
- **Permission dialog:** solicitação clara, capacidades, limites e possibilidade de interrupção.
- **Activity disclosure:** histórico técnico recolhido por padrão.
- **Status pill e inline notices:** estados de conexão e falha com texto, forma e cor.

### 8.3 Componentes removidos ou substituídos

- painel de logs permanente do aluno substituído por disclosure;
- grade de webcams de mesmo peso substituída por palco + picture-in-picture;
- painel técnico grande de controle remoto substituído por barra contextual;
- cards cumulativos de transferência substituídos por apoio contextual;
- emojis funcionais substituídos por SVGs consistentes e texto;
- referências internas como “Beta-5C” e “Canal P2P” removidas da linguagem principal;
- login genérico do professor substituído por entrada orientada ao produto;
- rótulos técnicos em caixa alta reduzidos a overlines discretas.

### 8.4 Componentes reutilizados

- todos os elementos de vídeo e seus IDs;
- botões e eventos existentes de chamada, mídia, tela, controle, arquivos e encerramento;
- elementos `dialog` nativos;
- listas geradas dinamicamente de logs e transferências;
- indicadores baseados em `data-indicator`;
- contratos de view model, preload e IPC;
- asset de marca existente.

### 8.5 Design system implementado

- mesma paleta semântica nos aplicativos do professor e do aluno;
- escala de espaçamento de 4 px;
- raios de 10, 14, 20 e 28 px;
- tipografia nativa sem download adicional;
- superfícies `canvas`, `surface`, `subtle` e `stage`;
- estados `brand`, `success`, `warning` e `danger`;
- botões primário, secundário, destrutivo, destrutivo suave e compacto;
- foco visível de 3 px;
- ícones SVG inline com `aria-hidden`;
- sombras restritas a superfícies elevadas;
- transições curtas e desativadas com movimento reduzido.

### 8.6 Melhorias de UX

- uma ação principal por etapa da jornada;
- comunicação promovida à maior área da janela;
- promoção automática da tela compartilhada ao palco principal;
- continuidade visual durante controle remoto;
- informações técnicas recolhidas;
- permissões explicadas por efeito e não por infraestrutura;
- ação de interrupção do controle remoto persistente;
- estados vazios que orientam o próximo passo;
- arquivos visíveis somente quando o canal está disponível;
- controles essenciais sem rolagem em 1366×768.

### 8.7 Melhorias de UI

- identidade visual única entre professor e aluno;
- maior espaço em branco nos estados de entrada e espera;
- superfícies mais leves e menos contornos aninhados;
- palco de alto contraste para mídia;
- picture-in-picture com borda e sombra;
- hierarquia tipográfica consistente;
- microinterações discretas;
- layouts fluidos para 1366×768, 1600×900, 1920×1080, 2560×1440 e 4K;
- uso integral da largura disponível no atendimento em telas grandes.

### 8.8 Melhorias de acessibilidade

- remoção de emojis variáveis dos rótulos de status;
- SVGs decorativos fora da árvore acessível;
- texto associado a todos os estados de cor;
- foco visível para botão, input, select e summary;
- `dialog` nativo para chamadas e permissões;
- labels explícitas e placeholders não usados como único rótulo;
- áreas interativas com altura mínima de 38–52 px;
- texto auxiliar ampliado em relação à interface anterior;
- suporte a `prefers-reduced-motion`;
- histórico secundário recolhido para reduzir anúncios e distrações.

### 8.9 Melhorias de performance

- nenhuma biblioteca, fonte remota ou imagem pesada adicionada;
- nenhum listener ou render adicional;
- streams de vídeo permanecem montados no mesmo DOM;
- mudanças de estado reaproveitam `hidden` e `data-*` existentes;
- animações restritas a propriedades leves;
- remoção de grandes áreas com `backdrop-filter`; o efeito permanece apenas em overlays pequenos;
- recursos auxiliares não geram novas superfícies ou janelas.

### 8.10 Arquivos modificados

- `.gitignore`
- `.prettierignore`
- `apps/teacher-electron/renderer/presence.html`
- `apps/teacher-electron/renderer/presence.css`
- `apps/teacher-electron/renderer/presence.ts`
- `apps/teacher-electron/renderer/i18n.ts`
- `apps/teacher-electron/tests/teacher-workflow.spec.ts`
- `apps/student-electron/renderer/index.html`
- `apps/student-electron/renderer/styles.css`
- `apps/student-electron/renderer/i18n.ts`
- `apps/student-electron/tests/student-workflow.spec.ts`
- `auditorias/SPRINT-BETA-8A-UX-UI-AUDITORIA-PLANEJAMENTO.md`

### 8.11 Comparação antes e depois

| Área                 | Antes                                  | Depois                                         |
| -------------------- | -------------------------------------- | ---------------------------------------------- |
| Filosofia            | painel técnico de acesso/sessão        | sala de atendimento educacional                |
| Professor disponível | card genérico de presença              | estado “Pronto para atender” orientado         |
| Aluno disponível     | formulário e logs com mesmo peso       | pedido de ajuda como ação central              |
| Atendimento          | grade de vídeos                        | palco principal + picture-in-picture           |
| Tela compartilhada   | novo bloco acima das webcams           | tela promovida ao palco; webcams em overlay    |
| Controle remoto      | painel técnico extenso                 | estado contextual sem mudança de tela          |
| Arquivos             | card completo e jargão P2P             | apoio contextual com confirmação               |
| Logs                 | coluna permanente                      | disclosure recolhido                           |
| Ícones               | emojis dependentes do sistema          | SVGs consistentes                              |
| Responsividade       | conteúdo cumulativo e rolagem provável | palco e controles essenciais dentro da janela  |
| Acessibilidade       | estados parcialmente por cor/emoji     | texto, forma, foco e movimento reduzido        |
| Performance          | superfícies amplas com efeitos         | CSS leve, sem dependências e sem novos renders |

## 9. Validação executada

- `npm run build`: **13/13 pacotes concluídos**.
- `npx turbo run build`: **13/13 pacotes concluídos**.
- lint: **13/13 pacotes concluídos**.
- typecheck: **13/13 pacotes concluídos**.
- testes: **11/11 tarefas concluídas**, incluindo professor, aluno, WebRTC, compartilhamento, controle remoto e transferência.
- validação estrutural: **48/48 IDs do professor** e **35/35 IDs do aluno** preservados, sem duplicatas.
- validação visual: estados de entrada, espera, atendimento, compartilhamento e controle em 1366×768 e 1920×1080; regras fluidas também cobrem 1600×900, 2560×1440 e 4K.
- Prettier nos arquivos da sprint: **aprovado**.

O `format:check` global também foi executado. Ele aponta três JSONs históricos já existentes em `auditorias/` (`beta-6c-baseline.json`, `beta-6c-window-lifecycle.json` e `session-accept-smoke.json`). Esses arquivos estão fora do escopo da Sprint Beta-8A e não foram alterados.
