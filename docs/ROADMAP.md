# Roadmap inicial

Este roadmap apresenta uma sequência inicial de evolução. O conteúdo das sprints 2 a 10 é
direcional e deve ser refinado antes de cada ciclo. Apenas a Sprint 1 está materializada neste
repositório.

## Sprint 1 — Fundação do projeto

Estruturar monorepo, workspaces, Turborepo, TypeScript, ferramentas de qualidade, limites
arquiteturais e documentação. Nenhuma funcionalidade de produto.

## Sprint 2 — Domínio e contratos

Modelar linguagem do domínio, casos de uso prioritários, contratos entre módulos, estratégia de
erros e plano de testes, ainda com infraestrutura mínima.

## Sprint 3 — Identidade e acesso

Implementar cadastro, autenticação, autorização por perfil e requisitos de segurança e
privacidade definidos pelo produto.

## Sprint 4 — Persistência e cadastros essenciais

Configurar PostgreSQL e Prisma, criar migrações e implementar os cadastros mínimos validados na
modelagem de domínio.

## Sprint 5 — Comunicação e presença

Introduzir Socket.IO, presença, eventos de conexão, reconexão e contratos de comunicação em
tempo real com observabilidade básica.

## Sprint 6 — Experiência do aluno

Construir o primeiro fluxo utilizável do aplicativo do aluno, com acessibilidade, estados de
erro e integração aos serviços já disponíveis.

## Sprint 7 — Experiência do professor

Construir o primeiro fluxo utilizável do aplicativo do professor, incluindo gestão do
atendimento e integração aos serviços existentes.

## Sprint 8 — Sessões de atendimento

Implementar ciclo de vida das sessões, filas, notificações e mecanismos de consistência entre os
dois clientes.

## Sprint 9 — Recursos remotos

Avaliar e implementar chamadas de vídeo e acesso remoto conforme requisitos de segurança,
consentimento, compatibilidade e conformidade aprovados.

## Sprint 10 — Produção e lançamento controlado

Consolidar testes ponta a ponta, segurança, telemetria, empacotamento Tauri, CI/CD, recuperação de
falhas, documentação operacional e piloto controlado.
