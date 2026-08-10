# Auto Update dos aplicativos Electron

Teacher e Student usam `electron-updater` por meio de `@professor-connect/update-manager`. O
provider é HTTP genérico e está embutido separadamente em cada instalador:

| Aplicativo | Feed estável                                                                             |
| ---------- | ---------------------------------------------------------------------------------------- |
| Teacher    | `https://professorconnect-professoread.lwf5hh.easypanel.host/updates/teacher/latest.yml` |
| Student    | `https://professorconnect-professoread.lwf5hh.easypanel.host/updates/student/latest.yml` |

Os canais Beta e Development usam `beta.yml` e `alpha.yml`. `app.getVersion()` é a versão
instalada considerada pelo updater. O YAML anuncia versão, arquivo, tamanho e SHA-512; o
`release-info.json` adicional anuncia Git SHA, build date e SHA-256.

## Fluxo

1. o app instalado carrega `resources/app-update.yml`;
2. após três segundos, consulta o YAML do canal com cache-buster;
3. compara a versão instalada com a anunciada;
4. baixa `.exe`/`.blockmap` e valida SHA-512;
5. preserva o candidato para rollback;
6. adia a instalação durante atendimento;
7. chama `quitAndInstall` quando seguro;
8. reinicia e registra a versão/build final.

Preferências ficam em `%APPDATA%\<produto>\update-manager\settings.json`; logs em
`update.log`; artefatos de rollback em `rollback`. Tokens e dados de autenticação ficam fora do
diretório do instalador e não são apagados pelo update.

## Logs e diagnóstico do cliente

O log registra marcadores `[UPDATE]` para versão instalada, app, Git SHA, Build ID, URL, canal,
consulta, versão encontrada, download, integridade, instalação, reinício solicitado e versão
final. Valores parecidos com tokens, secrets, senhas, Authorization e credenciais em URL são
redigidos antes de persistir.

No app, abra **Atualizações** para conferir Aplicativo, Versão, Git SHA, Build e Build ID. Para
inspeção técnica:

```powershell
Get-Content "$env:APPDATA\Professor Connect - Professor\update-manager\update.log" -Tail 100
Get-Content "$env:APPDATA\Professor Connect - Aluno\update-manager\update.log" -Tail 100
```

## Publicação no EasyPanel

O deploy Git do backend não contém `release-updates/`, pois binários são ignorados. Configure no
serviço backend um mount persistente chamado `windows-updates` em `/app/release-updates`, somente
leitura para o container quando a plataforma permitir. A documentação oficial do EasyPanel alerta
que dados sem mount somem no restart e descreve mounts Volume/Bind.

O workflow [Desktop CI and Release](../../.github/workflows/desktop-release.yml) transfere um pacote
imutável por SSH, valida-o em staging e troca um único link simbólico somente depois de todos os
hashes passarem. Essa troca disponibiliza manifestos e instaladores simultaneamente, sem cópia
manual por release. Credenciais de SSH e assinatura ficam no environment protegido do GitHub.
Consulte [Pipeline de release](./release-pipeline.md) para secrets, layout, retenção e rollback.

O backend deve responder:

- YAML e `release-info.json`: `200`, MIME correto e `Cache-Control: no-store, no-cache`;
- `.exe` e `.blockmap`: `200`, tamanho esperado e cache imutável;
- arquivo inexistente: `404`, nunca `500`.

Depois do upload:

```powershell
npm run updates:diagnose
npm run updates:diagnose -- --download
```

O diagnóstico recusa redirects e conteúdo HTML no lugar do manifesto e exibe uma linha
`UPDATE_STATUS` por aplicativo com APP, VERSION, GIT_SHA, UPDATE_URL, CURRENT_VERSION,
AVAILABLE_VERSION e os estados de manifesto, artefato e hash.

## Teste controlado A → B

Use uma VM Windows descartável, mas preserve `%APPDATA%` entre A e B.

1. gere, publique e instale a versão A; registre versão, Git SHA, SHA-256 do instalador e uma
   preferência não sensível;
2. incremente SemVer, faça commit limpo, gere e publique B;
3. confirme `updates:diagnose -- --download` antes de abrir A;
4. abra A e registre no log: consulta, versão B encontrada, download e integridade;
5. instale/reinicie pelo app;
6. confirme no Registro, na tela Atualizações e no log que B e o Git SHA de B estão ativos;
7. confirme que autenticação, organização e preferência continuam presentes;
8. repita separadamente para Teacher e Student;
9. repita uma instalação nova de B e uma atualização a partir da versão mais antiga suportada.

Um teste é reprovado se depender apenas de `updates:verify`, se o YAML/hash remoto divergir, se o
app não reiniciar em B, se o Git SHA não corresponder ou se dados do usuário forem perdidos.

## Diagnóstico de falhas

- `404/500 latest.yml`: mount ausente, caminho incorreto ou release não publicada;
- YAML antigo: volume desatualizado ou cache de proxy; confirme `no-store` e use cache-buster;
- versão igual: incremente SemVer e gere tudo novamente;
- SHA divergente: não publique; regenere/stage o conjunto inteiro;
- app aponta para host antigo: inspecione `resources/app-update.yml` e `dist/config.json` no ASAR;
- update baixa mas não instala: verifique atendimento ativo, `autoInstallOnAppQuit` e logs;
- assinatura inválida/ausente: não contorne `verifyUpdateCodeSignature`; configure Code Signing.
