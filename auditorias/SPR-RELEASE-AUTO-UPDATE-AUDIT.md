# Auditoria de release, Auto Update e sincronização

Data da auditoria: 2026-08-10  
Repositório: `professor-connect`  
HEAD auditado: `63922cf1ed450d8b2a3fd37ffe1c13c0440fc306`  
Estado: correções implementadas localmente; publicação e teste real A → B pendentes por regra da
sprint.

## Resumo executivo

O código novo não chegou aos computadores porque o servidor de atualização não possui uma release
publicada. Teacher e Student instalados estão em `0.1.1`, consultam os feeds corretos e recebem
HTTP `500` em `latest.yml`. O problema não está na detecção da URL pelo cliente: os logs reais dos
dois aplicativos registram a falha do `electron-updater`.

A causa de infraestrutura é objetiva: `release-updates/` é ignorado pelo Git e não entra na imagem
Docker. O Compose local monta esse diretório, mas o serviço criado diretamente do Dockerfile no
EasyPanel não tinha procedimento de mount/upload documentado. Assim, commit, push e deploy do
backend nunca publicaram os instaladores Windows.

Havia ainda riscos secundários: raiz/API em `0.1.0` enquanto Electron estava em `0.1.2`, nenhuma
identidade Git embutida, health sem versão/SHA, manifestos com cache de cinco minutos, ausência de
diagnóstico remoto e instaladores sem Authenticode.

## Evidências da causa raiz

### Computador auditado

| Aplicativo | Registro | Executável instalado SHA-256                                       | Identidade no ASAR                    |
| ---------- | -------: | ------------------------------------------------------------------ | ------------------------------------- |
| Teacher    |  `0.1.1` | `43085fc98a2857df7ad574f2f9808651b042f6ae350c6215d612a5b685f91892` | versão `0.1.1`; sem `build-info.json` |
| Student    |  `0.1.1` | `af02f565ef366bc7b8aa1b1239c3c0b570e694d72cae3b4ff57524d597924dc1` | versão `0.1.1`; sem `build-info.json` |

Ambos estão no canal `stable`, com download automático e instalação ao fechar habilitados. Seus
`resources/app-update.yml` apontam respectivamente para:

- `https://professorconnect-professoread.lwf5hh.easypanel.host/updates/teacher`;
- `https://professorconnect-professoread.lwf5hh.easypanel.host/updates/student`.

Os logs em `%APPDATA%\<produto>\update-manager\update.log` mostram `Checking for update` seguido de
`HttpError: 500` em `latest.yml`. A consulta independente reproduziu:

| URL                           | Resultado em 2026-08-10          |
| ----------------------------- | -------------------------------- |
| `/health`                     | `200`, somente `{"status":"ok"}` |
| `/api/health`                 | `404`                            |
| `/updates/teacher/latest.yml` | `500`                            |
| `/updates/student/latest.yml` | `500`                            |
| `/updates/teacher/beta.yml`   | `500`                            |
| `/updates/student/beta.yml`   | `500`                            |

O ASAR Teacher instalado não contém `students:presence:get`, `students:presence:changed` nem
`online-students-list`. Portanto a lista operacional de alunos online não está no computador. O
Student `0.1.1` contém uma etapa anterior da fila, mas não o listener recente
`session:request:error`; o conjunto instalado não corresponde ao commit auditado.

### Pipeline

O fluxo efetivo anterior era:

```text
commit/push -> EasyPanel compila backend -> backend reinicia
                                         X
build Electron local -> release/ -> release-updates/ (ignorado) -> sem upload/mount
```

`npm run updates:verify` validava somente arquivos locais. `npm run updates:stage` copiava para um
diretório também ignorado. O antigo `publish:win` acionava Electron Builder com provider genérico,
mas não havia credencial, destino de upload ou etapa que abastecesse o volume EasyPanel. Deploy do
backend e publicação Windows eram incorretamente tratados como se fossem o mesmo processo.

## Auditoria de versões

Antes da correção:

| Componente                         |               Versão |
| ---------------------------------- | -------------------: |
| raiz/produto                       |              `0.1.0` |
| API/backend                        |              `0.1.0` |
| Teacher Electron/installer/updater |              `0.1.2` |
| Student Electron/installer/updater |              `0.1.2` |
| instalado Teacher/Student          |              `0.1.1` |
| servidor de update                 | indisponível (`500`) |

Depois da correção local, raiz, API, Teacher, Student e lockfile estão em `0.1.3`. Os workspaces
internos permanecem `0.1.0` por terem versão de pacote própria. `updates:diagnose` exige igualdade
entre as quatro fontes de release, reduzindo o risco de divergência.

## Build `0.1.3` auditado

Os builds abaixo são de QA e **não podem ser promovidos**, pois foram gerados antes do commit das
correções e carregam `dirty: true`.

| Campo                | Teacher                                                                                    | Student                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| artefato             | `Professor-Connect-Professor-Setup-0.1.3-x64.exe`                                          | `Professor-Connect-Aluno-Setup-0.1.3-x64.exe`                                              |
| target / arquitetura | NSIS / x64                                                                                 | NSIS / x64                                                                                 |
| tamanho              | `100486844`                                                                                | `100985162`                                                                                |
| build UTC            | `2026-08-10T20:25:41.375Z`                                                                 | `2026-08-10T20:23:57.961Z`                                                                 |
| Git SHA base         | `63922cf1ed450d8b2a3fd37ffe1c13c0440fc306`                                                 | igual                                                                                      |
| Build ID             | `0.1.3+63922cf.dirty`                                                                      | `0.1.3+63922cf.dirty`                                                                      |
| SHA-256              | `859cbca829a99b852cf33d15e3ef31de3295900ae6d60cee8efd97e1897bd690`                         | `cd5429b6e44ba0b0accff7e0411ddb296f9233287518192366a5ed6898f89fe3`                         |
| SHA-512 (base64)     | `zK2+u4D6pmcj3S3Vm3e/bhpggvkjlVZB41Cod9NVK5qjvldBoRsdCdhCh9xpWMgKWDDRyaPUsfMYuZo68nZXEg==` | `sYZhfggvZYSy1tJYdeidAMchpPwvF9UNeHtg4az2jLEfEHIRzxT2arD0ynwBpYRwzAgTA2kX4X87AkmP+yEkRQ==` |
| Authenticode         | `NotSigned`                                                                                | `NotSigned`                                                                                |

O `release-info.json` foi comparado com o `.exe` e o YAML. A extração direta do ASAR confirmou
`dist/build-info.json`, tela com Build ID, fila do Student e presença/lista online do Teacher. Isso
prova que o código não se perde entre TypeScript, build e empacotamento.

`updates:verify` recusou corretamente esses arquivos com “build não commitado”. Após o commit, é
obrigatório rebuildar; os hashes finais serão diferentes e o Git SHA será o novo commit limpo.

## Auto Update

- biblioteca: `electron-updater`, encapsulada em `@professor-connect/update-manager`;
- provider: `generic` HTTPS;
- feeds: `latest.yml`, `beta.yml`, `alpha.yml` por aplicativo;
- versão instalada: `app.getVersion()`;
- download: manual ou automático conforme preferência;
- integridade: SHA-512 do metadata e validação adicional antes do rollback;
- instalação: `quitAndInstall(true, true)` fora de atendimento;
- restart: solicitado pelo updater após download;
- logs: `%APPDATA%\<produto>\update-manager\update.log`;
- dados: autenticação/configuração ficam em `userData`, fora do diretório de instalação.

Foram adicionados logs `[UPDATE]` de identidade, URL/canal, consulta, versão encontrada, download,
integridade, instalação/restart e versão final. O logger passou a redigir tokens, secrets, senhas,
Authorization e credenciais em URL.

O teste unitário cobre detecção, ausência de update, rede, download, integridade, instalação,
adiamento durante atendimento e redaction. Isso não substitui o teste real A → B.

## Backend, API e WebSocket

O backend local passa a expor `/health` e `/api/health` com:

```json
{
  "status": "ok",
  "version": "0.1.3",
  "gitSha": "<sha-ou-unknown>",
  "buildDate": "<data-ou-unknown>",
  "environment": "production"
}
```

Docker/Compose aceitam `APP_VERSION`, `GIT_SHA` e `BUILD_DATE` e propagam identidade para labels e
runtime. Produção ainda não expõe esse contrato, logo seu commit permanece desconhecido.

Teacher e Student, tanto no código como nas instalações `0.1.1`, usam o mesmo host HTTPS para API e
Socket.IO; não foi encontrado `localhost`, `127.0.0.1` ou domínio antigo nas configurações de
produção. O handshake Engine.IO remoto respondeu `200`, retornou `sid` e anunciou upgrade
`websocket`. Isso prova conectividade, não a versão do código WebSocket remoto.

## Cache e servidor de update

O backend foi alterado para:

- YAML e `release-info.json`: `no-store, no-cache, must-revalidate`;
- `.exe`/`.blockmap`: cache público imutável, pois o nome contém a versão;
- arquivo inexistente: `404 update_artifact_not_found`, não `500`;
- MIME explícito para YAML/JSON e `nosniff`.

EasyPanel precisa de Volume persistente `windows-updates` montado em `/app/release-updates`. O
upload deve copiar binários/blockmaps primeiro e YAML por último. Sem acesso operacional ao painel
ou SSH, o mount/upload não foi executado, respeitando a proibição de deploy automático.

## Dados e assinatura

NSIS usa instalação por usuário. Preferências do updater, autenticação segura, organização e
recuperação ficam em `%APPDATA%`; a atualização não remove esses diretórios. A preservação real
deve ser confirmada na VM A → B.

Teacher e Student `0.1.1`, `0.1.2` e `0.1.3` auditados não têm Authenticode. O log do builder
“signing with signtool.exe” não é evidência de assinatura; `Get-AuthenticodeSignature` retornou
`NotSigned`. Impacto: SmartScreen/reputação e ausência da garantia de publisher. Requisito futuro:
certificado Code Signing via secrets `CSC_LINK`/`CSC_KEY_PASSWORD`, sem contorno da verificação.

## Correções implementadas

1. versão coordenada `0.1.3` e lockfile sincronizado;
2. identidade `application/version/gitSha/buildDate/dirty/buildId` gerada antes do ASAR;
3. identidade visível na interface Atualizações;
4. `release-info.json` com SHA-256/SHA-512/tamanho/target/arquitetura;
5. stage/verify recusa build dirty e inclui o manifesto de identidade;
6. `updates:diagnose` compara código, artefatos, feeds, cache, hashes, health e SHA remoto;
7. logs de updater completos e sanitizados;
8. health versionado em duas rotas;
9. cache correto e 404 para release ausente;
10. Docker/Compose com metadados de build;
11. scripts `publish:win` enganosos removidos;
12. documentação de build, publicação, EasyPanel e teste A → B atualizada.

## Testes executados

| Validação                                    | Resultado                           |
| -------------------------------------------- | ----------------------------------- |
| typecheck Update Manager/Teacher/Student/API | aprovado                            |
| testes Update Manager                        | 10/10                               |
| testes API                                   | 28/28                               |
| build-all `0.1.3`                            | aprovado para QA                    |
| inspeção de ASAR e identidade                | aprovada                            |
| SHA-256/SHA-512/tamanho local                | aprovados                           |
| Authenticode                                 | reprovado (`NotSigned`)             |
| `updates:verify` do build atual              | bloqueado corretamente (`dirty`)    |
| feed remoto Teacher/Student                  | reprovado (`500`)                   |
| health remoto versionado                     | reprovado (`/api/health` 404)       |
| handshake Socket.IO                          | aprovado                            |
| update real Teacher `0.1.1 → 0.1.3`          | não executado: feed não publicado   |
| update real Student `0.1.1 → 0.1.3`          | não executado: feed não publicado   |
| primeira instalação/preservação de dados     | não executado: requer VM controlada |

## Critérios de aceite

Concluídos localmente: versão/build/executáveis auditados; identidade SHA; versão visível; URLs
API/WS; código da fila dentro do ASAR; causa raiz; correções de código; documentação; diagnóstico;
hashes locais; cache do backend.

Pendentes de operação externa: mount EasyPanel, upload, hash remoto byte a byte, backend versionado
publicado, assinatura válida e testes reais separados Teacher/Student (instalação nova e update
A → B). A sprint não deve ser marcada como encerrada até esses itens passarem.

## Sequência obrigatória para promoção

```powershell
git add <arquivos auditados>
git commit -m "fix(release): make desktop updates traceable and verifiable"
npm ci
npm run check
npm run build-all
npm run updates:verify
npm run updates:stage
```

Depois, configure/abasteça o mount sem apagar dados, publique o backend com o SHA/data corretos e
execute:

```powershell
npm run updates:diagnose
npm run updates:diagnose -- --download
```

Somente então rode o roteiro A → B de `docs/deploy/auto-update.md` em VM para Teacher e Student e
registre versão/Git SHA antes e depois.

Commit sugerido: `fix(release): make desktop updates traceable and verifiable`.
