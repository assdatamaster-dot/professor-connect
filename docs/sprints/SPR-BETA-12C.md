# Sprint Beta-12C — Intelligent Auto Update System

## Arquitetura

O módulo `@professor-connect/update-manager` é compartilhado pelos clientes Professor e Aluno. A
regra de atualização não fica nos renderers nem nos controladores de atendimento.

```text
UpdateManager
├── VersionService
├── UpdateChecker
├── DownloadManager
├── InstallManager
├── RollbackManager
├── ReleaseNotesService
├── UpdateSettingsStore
├── UpdateAuditReporter
└── UpdateUIController
```

Os aplicativos apenas compõem o módulo com `app`, `WebContents`, URL do backend e o estado real do
atendimento. Controle remoto, vídeo, compartilhamento de tela e transferência acontecem dentro de
uma sessão ativa; por isso a sessão é a trava atômica de instalação. Download em segundo plano é
permitido, mas instalação/reinício nunca ocorre enquanto essa trava estiver ativa.

## Fluxo de produção

1. No início, o cliente carrega preferências, verifica eventual recuperação e agenda verificações.
2. `electron-updater` consulta `latest.yml`, `beta.yml` ou `alpha.yml` no provider configurado.
3. A atualização é baixada silenciosamente com progresso, velocidade e tempo restante.
4. O SHA-512 do metadata é verificado pelo updater e novamente antes de preservar o instalador de
   rollback. No Windows, `electron-updater` valida Authenticode quando o build está assinado.
5. Se não há atendimento, o usuário pode reiniciar ou deixar instalar ao fechar.
6. Se há atendimento, a instalação é adiada e iniciada automaticamente após o encerramento.
7. Após uma atualização, três inicializações não saudáveis ou uma falha fatal durante a janela de
   saúde acionam o instalador preservado da versão anterior.

Preferências ficam em `userData/update-manager/settings.json`, logs rotativos em
`userData/update-manager/update.log` e instaladores de recuperação em
`userData/update-manager/rollback`.

## Canais

| Produto         | Canal da interface | Canal electron-updater |
| --------------- | ------------------ | ---------------------- |
| Produção        | Stable             | `latest`               |
| Homologação     | Beta               | `beta`                 |
| Desenvolvimento | Development        | `alpha`                |

`generateUpdatesFilesForAllChannels` gera metadata para os três canais. Stable nunca recebe uma
pré-release; Beta e Development habilitam pré-releases segundo a precedência do updater.

## Publicação

O provider atual é HTTP genérico, servido em `/updates/{teacher,student}` pelo backend e montado em
Docker/EasyPanel por `UPDATE_ARTIFACTS_HOST_PATH`.

```powershell
npm run build-all
npm run updates:verify
npm run updates:stage
```

O último comando prepara `release-updates/teacher` e `release-updates/student`. Em CI, publique ou
monte esse diretório no volume de artefatos antes de promover a release. O backend expõe:

- `GET /api/version/latest?application=teacher&channel=stable`;
- `GET /api/version/check?currentVersion=1.0.0&application=teacher&channel=stable`;
- `POST /api/version/events` para auditoria/inventário;
- `GET /api/admin/updates` para o painel;
- `POST /api/admin/updates/releases` para registrar uma publicação.

Para GitHub Releases, S3 ou outro servidor genérico, altere somente `build.publish` nos dois
`package.json`; o Update Manager continua consumindo o `app-update.yml` gerado pelo builder. Em
GitHub use `provider: "github"`, `owner`, `repo`, `channel` e `GH_TOKEN` somente no CI. Em S3 use
`provider: "s3"`, `bucket`, `region` e credenciais somente no ambiente de publicação.

## Code signing Windows

O build já usa NSIS e `verifyUpdateCodeSignature: true`. Quando o certificado estiver disponível,
configure no CI:

```text
CSC_LINK=<PFX em base64 ou caminho seguro>
CSC_KEY_PASSWORD=<senha no secret store>
```

Nunca armazene PFX ou senha no repositório. O nome do publisher é derivado do certificado durante o
build e gravado no `app-update.yml`. Antes da promoção, valide `Get-AuthenticodeSignature` com status
`Valid`. Builds locais sem certificado permanecem úteis para QA, mas não devem ser publicados.

## Operação

- A versão precisa ser incrementada antes do build; republicar a mesma versão não atualiza clientes.
- Instalador, blockmap e YAML devem vir do mesmo build. `npm run updates:verify` impede mistura.
- Uma release defeituosa deve ser substituída por versão numericamente superior; não reutilize tag.
- O health check pós-instalação promove o instalador candidato a base do próximo rollback.
- O endpoint administrativo contabiliza clientes por aplicação, canal e versão observada.
