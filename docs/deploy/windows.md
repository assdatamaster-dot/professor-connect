# Instaladores Windows

Este guia descreve como gerar e distribuir os dois instaladores Windows x64 do Professor Connect.
O empacotamento não altera o comportamento dos clientes: ele compila os mesmos processos
main/preload/renderer e os entrega em instaladores NSIS separados.

## Pré-requisitos

- Windows 10 ou 11 x64;
- Node.js 22.12 ou superior;
- npm 10 ou superior;
- acesso à internet no primeiro build para baixar os binários do Electron e do NSIS.

Na raiz do repositório, instale exatamente as dependências do lockfile:

```powershell
npm ci
```

## Gerar os instaladores

Aluno:

```powershell
npm run build-student
```

Professor:

```powershell
npm run build-teacher
```

Os dois, em sequência:

```powershell
npm run build-all
```

Os artefatos finais são:

```text
release/student/Professor-Connect-Aluno-Setup-0.1.0-x64.exe
release/teacher/Professor-Connect-Professor-Setup-0.1.0-x64.exe
```

`release/` é uma saída local de build e não deve ser versionada. Os arquivos `.blockmap` e os
diretórios `win-unpacked` são artefatos auxiliares; a distribuição ao usuário final usa o `.exe`.

## Metadados configurados

| Item       | Aluno                                   | Professor                               |
| ---------- | --------------------------------------- | --------------------------------------- |
| Nome       | Professor Connect - Aluno               | Professor Connect - Professor           |
| Versão     | 0.1.0                                   | 0.1.0                                   |
| Fabricante | Professor Connect                       | Professor Connect                       |
| App ID     | `br.com.professorconnect.student`       | `br.com.professorconnect.teacher`       |
| Executável | `Professor Connect Aluno.exe`           | `Professor Connect Professor.exe`       |
| Ícone      | `apps/student-electron/assets/icon.svg` | `apps/teacher-electron/assets/icon.svg` |

O Electron Builder converte o SVG para os formatos do Windows. O NSIS cria um atalho na Área de
Trabalho, outro no Menu Iniciar e uma entrada de desinstalação em **Configurações > Aplicativos**.
O instalador é assistido, permite escolher o diretório e instala apenas para o usuário atual.

## Alterar a versão

Antes de uma nova entrega, atualize o campo `version` dos dois `package.json` dos clientes e o
campo `version` da raiz. Execute `npm install --package-lock-only` para sincronizar o lockfile e
gere novamente os instaladores. O nome do arquivo recebe a versão automaticamente.

## Assinatura de código

Os instaladores Beta-1A não são assinados porque o repositório não contém certificado de assinatura.
O Windows pode exibir o SmartScreen. Para distribuição pública, configure um certificado de Code
Signing por variáveis seguras do CI; nunca versione o arquivo do certificado ou sua senha.

## Checklist de validação

Em uma máquina Windows de teste:

1. confira se os dois `.exe` existem e possuem tamanho maior que zero;
2. instale cada perfil e confirme o nome, o ícone e a versão em **Aplicativos instalados**;
3. confirme os atalhos da Área de Trabalho e do Menu Iniciar;
4. abra cada cliente e valide que a janela local é carregada;
5. desinstale em **Configurações > Aplicativos** e confirme a remoção dos atalhos;
6. execute `npm run check` no repositório antes de publicar os binários.

Referência: [Electron Builder — NSIS](https://www.electron.build/docs/nsis/) e
[Electron Builder — ícones](https://www.electron.build/docs/features/icons-and-images/).
