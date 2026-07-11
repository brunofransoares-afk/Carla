# TASKS — Aurora

Checklist executável. Atualizado a cada etapa. `[x]` feito · `[~]` em andamento · `[ ]` a fazer.

## ✅ Fase de Planejamento (PRIMEIRA MISSÃO)
- [x] Analisar referências (Finest) e repositório atual
- [x] Definir arquitetura (`docs/01-ARCHITECTURE.md`)
- [x] Definir tecnologias + justificativas + questionamentos (`docs/02-TECH-DECISIONS.md`)
- [x] Modelar banco de dados completo (`docs/03-DATABASE.md`)
- [x] Definir estrutura de pastas (`docs/04-FOLDER-STRUCTURE.md`)
- [x] Listar riscos técnicos + melhorias (`docs/05-RISKS-AND-IMPROVEMENTS.md`)
- [x] Desenhar motor de inteligência/copiloto (`docs/06-INTELLIGENCE-ENGINE.md`)
- [x] Criar ROADMAP em fases (`ROADMAP.md`)
- [x] Criar este TASKS.md
- [ ] **Validar plano com o dono do produto** (decisões em `docs/05`) ← próximo passo humano

## Fase 0 — Fundações (não iniciada)
- [ ] Inicializar monorepo (pnpm-workspace, turbo.json, package.json raiz)
- [ ] `packages/config` (tsconfig, eslint, prettier, tailwind preset)
- [ ] `packages/db` (schema.prisma a partir de `docs/03`, migration inicial, seed)
- [ ] `packages/contracts` (Zod: auth + workspace + transaction)
- [ ] `packages/ui` (tema dark premium, tokens de cor laranja/branco/cinza, shadcn base)
- [ ] `apps/api` NestJS (config, health, logger pino, filtro de erro, Sentry/OTel)
- [ ] Módulo `auth` (Argon2, JWT+refresh rotacionado, OAuth Google, guards)
- [ ] Módulo `workspaces` + Guard de escopo por `workspaceId`
- [ ] `apps/web` Next.js (shell, sidebar Pessoal/Empresa, telas de auth, api client)
- [ ] `infra/docker-compose.yml` (Postgres + Redis)
- [ ] CI GitHub Actions (lint → typecheck → test → build)
- [ ] Deploy inicial (Vercel + Railway + Postgres/Redis)

> As tarefas das Fases 1–8 serão detalhadas ao entrar em cada fase, para não inflar a lista.

## Registro de decisões pendentes (do dono)
- [ ] Repo dedicado vs. `platform/` neste repo
- [ ] Nome comercial (codinome atual: `Aurora`)
- [ ] Confirmar infra/host + orçamento
- [ ] Confirmar MVP começando por pessoa física
