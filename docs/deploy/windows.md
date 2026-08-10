# Release dos aplicativos Windows

Este é o procedimento aprovado para compilar, identificar e preparar os instaladores NSIS x64 do
Professor Connect. Deploy do backend e publicação dos aplicativos Windows são operações separadas.

## Fontes de versão

A versão de release deve ser idêntica nestes quatro arquivos:

- `package.json` (versão coordenadora do produto);
- `services/backend/api/package.json` (versão exposta pelo health);
- `apps/teacher-electron/package.json` (Teacher, instalador e updater);
- `apps/student-electron/package.json` (Student, instalador e updater).

Os demais workspaces `0.1.0` são pacotes internos e têm ciclo próprio. Antes de uma release, altere
os quatro campos acima e sincronize o lockfile:

```powershell
npm install --package-lock-only --ignore-scripts
npm run updates:diagnose -- --local-only
```

O segundo comando deve acusar os artefatos antigos até que um novo build seja produzido. Nunca
republique o mesmo número: `electron-updater` só oferece uma versão semanticamente superior.

## Identidade do build

Cada build gera `dist/build-info.json` antes do empacotamento, contendo:

```json
{
  "application": "teacher",
  "version": "0.1.3",
  "gitSha": "<SHA completo>",
  "buildDate": "<data ISO>",
  "dirty": false,
  "buildId": "0.1.3+<SHA curto>"
}
```

O arquivo entra no ASAR e esses dados aparecem em **Atualizações** dentro do aplicativo. Um build
feito com alterações não commitadas recebe `dirty: true`; ele serve para QA local, mas
`updates:verify` e `updates:stage` recusam promovê-lo.

## Gerar os instaladores

Pré-requisitos: Windows 10/11 x64, Node.js 22.12+, npm 10+ e worktree limpo no commit aprovado.

```powershell
npm ci
npm run check
npm run build-all
```

Comandos individuais:

```powershell
npm run build-student
npm run build-teacher
```

`dist:win` recompila dependências e processos main/preload/renderer, executa Electron Builder e
gera `release-info.json`. Os artefatos finais são:

```text
release/student/Professor-Connect-Aluno-Setup-<version>-x64.exe
release/student/Professor-Connect-Aluno-Setup-<version>-x64.exe.blockmap
release/student/{latest,beta,alpha}.yml
release/student/release-info.json
release/teacher/Professor-Connect-Professor-Setup-<version>-x64.exe
release/teacher/Professor-Connect-Professor-Setup-<version>-x64.exe.blockmap
release/teacher/{latest,beta,alpha}.yml
release/teacher/release-info.json
```

`release/` é saída local ignorada pelo Git. O `.exe`, o `.blockmap`, os YAML e
`release-info.json` devem sempre vir do mesmo build.

## Provar o conteúdo do executável

Não use apenas nome ou data do arquivo. Valide:

```powershell
npm run updates:verify
npm run updates:diagnose -- --local-only
Get-FileHash release\teacher\Professor-Connect-Professor-Setup-<version>-x64.exe -Algorithm SHA256
Get-FileHash release\student\Professor-Connect-Aluno-Setup-<version>-x64.exe -Algorithm SHA256
Get-AuthenticodeSignature release\teacher\Professor-Connect-Professor-Setup-<version>-x64.exe
Get-AuthenticodeSignature release\student\Professor-Connect-Aluno-Setup-<version>-x64.exe
```

`release-info.json` liga versão, SHA-256/SHA-512, tamanho e Git SHA. Para auditoria adicional, abra
`release/<app>/win-unpacked/resources/app.asar` com `npx asar list`/`extract-file` e confirme
`dist/build-info.json` e os módulos esperados.

## Preparar, publicar e validar

```powershell
npm run updates:stage
```

Isso cria `release-updates/{teacher,student}`. O comando local não publica na internet. Em QA, o
workflow guarda esse diretório como GitHub Actions Artifact. Em uma tag oficial, o job protegido
transfere e promove o pacote no mount persistente `/app/release-updates` conforme
[Pipeline de release](./release-pipeline.md), [Auto Update](./auto-update.md) e
[EasyPanel](./easypanel.md). Depois valide sem cache:

```powershell
npm run updates:diagnose
npm run updates:diagnose -- --download
```

O primeiro compara versões, manifestos, Git SHA, tamanhos e hashes anunciados. `--download` baixa
os dois instaladores publicados e compara SHA-256 byte a byte; use-o na promoção final.

## Assinatura e dados do usuário

Os builds locais auditados não possuem certificado Authenticode e não devem ser promovidos como
release pública. Para produção, forneça `WIN_CSC_LINK` e `WIN_CSC_KEY_PASSWORD` somente pelo
environment `desktop-production`. O workflow exige `Status: Valid` no instalador e no executável
empacotado; sem certificado ele falha antes da publicação. Azure Trusted Signing pode substituir
o PFX no futuro, mas requer configurar conta, endpoint e metadados específicos antes de alterar o
workflow.

NSIS instala por usuário e preserva `%APPDATA%\Professor Connect - Professor` e
`%APPDATA%\Professor Connect - Aluno`, onde ficam autenticação segura, preferências, recuperação
de sessão e estado do updater. Nunca apague esses diretórios durante um teste de atualização.

O teste real A → B, primeira instalação, atualização e rollback está descrito em
[Auto Update](./auto-update.md).
