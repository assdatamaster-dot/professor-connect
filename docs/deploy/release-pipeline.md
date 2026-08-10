# Pipeline de release dos aplicativos Windows

O pipeline preserva o provider HTTP `generic` e separa completamente o deploy do backend da
publicação dos aplicativos. O EasyPanel constrói somente o backend Linux; o GitHub Actions usa
um runner Windows para gerar e assinar Teacher e Student.

```text
push/PR/manual -> quality -> build QA -> GitHub Actions Artifact (nunca produção)
tag vX.Y.Z     -> quality -> environment desktop-production -> build assinado
               -> pacote imutável -> SSH -> staging -> validação -> troca atômica
               -> diagnóstico remoto -> GitHub Release auditável
```

O workflow está em `.github/workflows/desktop-release.yml`. Uma release oficial é aceita somente
quando a tag é exatamente `v` mais a versão SemVer comum ao package raiz, backend, Teacher e
Student. O checkout precisa estar limpo e seu SHA precisa ser o `GITHUB_SHA`.

## Decisão de armazenamento

Foram consideradas GitHub Releases, object storage e o volume persistente do EasyPanel. O volume
foi escolhido como origem porque mantém o contrato já embarcado nos clientes:

- Teacher: `/updates/teacher/latest.yml`;
- Student: `/updates/student/latest.yml`.

Migrar para GitHub Releases exigiria trocar o provider/configuração embutida nos instaladores já
distribuídos. O GitHub Release continua sendo criado depois da promoção como arquivo de auditoria,
mas não é o feed do updater. Object storage continua sendo uma evolução possível quando houver
credenciais e domínio dedicados.

## Proteção no GitHub

Crie o environment `desktop-production` e habilite revisores obrigatórios, restrição para tags
protegidas e prevenção de autoaprovação, conforme a disponibilidade do plano do repositório.
Cadastre nele, e não como texto do workflow:

| Nome                        | Uso                                                              |
| --------------------------- | ---------------------------------------------------------------- |
| `WIN_CSC_LINK`              | PFX em Base64 ou referência privada aceita pelo electron-builder |
| `WIN_CSC_KEY_PASSWORD`      | senha do PFX                                                     |
| `UPDATE_DEPLOY_HOST`        | host SSH que possui acesso ao volume                             |
| `UPDATE_DEPLOY_USER`        | usuário de deploy sem privilégios administrativos                |
| `UPDATE_DEPLOY_PATH`        | caminho absoluto do volume no host                               |
| `UPDATE_DEPLOY_PRIVATE_KEY` | chave SSH exclusiva de deploy                                    |
| `UPDATE_DEPLOY_HOST_KEY`    | linha `known_hosts` previamente conferida e fixada               |
| `UPDATE_DEPLOY_PORT`        | porta SSH; opcional, padrão 22                                   |

Crie a variable `UPDATE_RELEASE_RETENTION` com valor `3` ou maior. A chave SSH deve ter acesso
somente ao diretório de updates e aos comandos necessários. O host precisa oferecer `sh`, `tar`,
`sha256sum`, `openssl`, `base64` e utilitários GNU usuais. Nunca use a chave de administração do
EasyPanel ou da VPS.

O job de produção falha antes do build se qualquer secret estiver ausente. Depois do build, ele
exige Authenticode `Valid` tanto no instalador quanto no executável empacotado. QA pode permanecer
sem assinatura.

## Configuração do volume

No app backend do EasyPanel, monte o volume persistente `windows-updates` em
`/app/release-updates`. Descubra no host o caminho real desse mesmo volume e grave-o em
`UPDATE_DEPLOY_PATH`. O usuário SSH precisa escrever nesse caminho; o container backend precisa
apenas ler. Não use o filesystem efêmero da imagem.

A primeira configuração deve deixar `teacher` e `student` ausentes ou como links simbólicos do
layout abaixo. O script recusa substituir diretórios reais e exige migração operacional explícita,
evitando apagar um acervo existente.

```text
<volume>/
  .staging/
  .releases/<version>-<git-sha>/teacher/
  .releases/<version>-<git-sha>/student/
  .current -> .releases/<version>-<git-sha>
  teacher -> .current/teacher
  student -> .current/student
  .current-release
  .previous-release
```

O pacote inteiro é enviado a `/tmp`, conferido por SHA-256 e extraído em `.staging`. O servidor
valida manifestos, tamanho, SHA-512, blockmaps e `release-info.json`. Só depois move o diretório
imutável para `.releases` e troca `.current` com um rename atômico. Assim nenhum `latest.yml`
novo aponta para um instalador ainda incompleto e Teacher/Student mudam juntos.

O backend deve seguir links simbólicos dentro do mount. Confirme isso no volume de QA antes da
primeira tag oficial. Reiniciar ou reconstruir o container não é necessário para uma release
desktop.

## Desenvolvimento e QA

Para a validação local equivalente, em um commit limpo:

```powershell
npm ci
npm run release:qa
```

Em PR, push para `main` ou `workflow_dispatch`, o job QA produz
`desktop-qa-<version>-<sha>` com instaladores, manifestos, blockmaps, hashes e relatório. A retenção
é 14 dias e nenhum passo possui os secrets ou publica no servidor.

## Release oficial

Sincronize os quatro `package.json` e o lockfile, faça commit e aguarde o CI. Depois:

```powershell
git tag v0.1.4
git push origin v0.1.4
```

O job somente continua depois da aprovação do environment. Ele valida `/api/health`, compila,
assina, prova o ASAR, empacota, preserva o Artifact por 30 dias, promove, baixa novamente os dois
instaladores e compara SHA-256. Se a verificação pós-publicação falhar, troca `.current` de volta
para `.previous-release` e falha o job. O GitHub Release só é criado depois dessa validação.

Não force novamente a mesma tag com outro conteúdo. Corrija o problema e publique uma nova
versão SemVer.

## Rollback

De uma estação autorizada com checkout do repositório, envie o script por SSH; ele não precisa
ficar instalado no servidor e o rollback não apaga arquivos:

```powershell
Get-Content -Raw scripts/rollback-update-release.sh |
  ssh -i <chave> usuario@host "sh -s -- '/caminho/real/do/volume'"
```

Para selecionar uma release preservada:

```powershell
Get-Content -Raw scripts/rollback-update-release.sh |
  ssh -i <chave> usuario@host "sh -s -- '/caminho/real/do/volume' '0.1.3-<git-sha-completo>'"
```

O script troca somente `.current`, registra o antigo current como previous e mantém ambos os
aplicativos sincronizados. Depois execute, a partir de um checkout que corresponda ao alvo:

```powershell
npm run updates:diagnose -- --download --allow-backend-version-mismatch
```

Retenção padrão: current, previous e mais uma release recente. `.staging` é transitório e é
limpo ao terminar ou falhar. GitHub Artifacts têm retenção separada de 14 dias (QA) e 30 dias
(release).

## Diagnóstico

```powershell
npm run updates:diagnose
npm run updates:diagnose -- --download
```

O diagnóstico recusa redirect, HTTP diferente de 200, HTML no lugar do YAML, cache indevido,
versão/artefato/hash divergentes e identidade inválida do backend. A opção
`--allow-backend-version-mismatch` mantém as validações de status/version/Git SHA, mas permite o
ciclo de release independente do backend.

Falhas comuns:

- `latest.yml` 404/500: volume ausente, caminho incorreto ou links não visíveis no container;
- assinatura recusada: PFX/senha incorretos, cadeia não confiável ou executável não assinado;
- host key recusada: atualize o secret somente depois de conferir a mudança fora do workflow;
- diretório real recusado: execute a migração inicial do acervo com backup;
- manifesto antigo: confira `Cache-Control` no proxy e se `.current` aponta para a release correta;
- SHA divergente: não contorne a trava; produza uma nova release a partir de um checkout limpo.

O teste real A → B em VM Windows continua obrigatório antes de liberar a primeira tag aos
usuários. O workflow prova o pacote e o servidor, mas não substitui a prova de instalação,
reinício, persistência de `%APPDATA%`, WebSocket e fila.
