# 01 — Arquitetura

## 1. Visão em uma frase

Monorepo TypeScript com **web app Next.js** (Vercel) consumindo uma **API NestJS** (Railway)
que segue **Clean Architecture**, apoiada por **PostgreSQL** (dados), **Redis** (fila/cache),
**workers BullMQ** (sync bancário, insights, alertas, relatórios) e um **motor de
inteligência determinístico** que serve de fonte para o **copiloto LLM**.

## 2. Diagrama de alto nível

```
                          ┌───────────────────────────────────────────────┐
                          │                  CLIENTES                      │
                          │   Navegador (Next.js / React)  ·  Mobile (PWA) │
                          └───────────────────────┬───────────────────────┘
                                                  │ HTTPS (JWT em cookie httpOnly)
                          ┌───────────────────────▼───────────────────────┐
       Vercel  ───────▶   │             WEB APP  (Next.js App Router)       │
                          │   RSC + shadcn/ui + Tailwind + Framer + Recharts│
                          └───────────────────────┬───────────────────────┘
                                                  │ REST/JSON (contrato tipado @aurora/contracts)
                          ┌───────────────────────▼───────────────────────┐
       Railway ───────▶   │                API  (NestJS)                    │
                          │  Interface(HTTP) → Application(use-cases)       │
                          │        → Domain(entities) → Infra(Prisma,LLM)   │
                          └───┬───────────────┬───────────────┬────────────┘
                              │               │               │
                 ┌────────────▼───┐   ┌───────▼──────┐  ┌─────▼────────────┐
                 │  PostgreSQL    │   │    Redis     │  │  Provedores      │
                 │  (Prisma)      │   │ fila + cache │  │  externos        │
                 └────────────────┘   └───────┬──────┘  │  · Pluggy (OF)   │
                                              │         │  · Claude / OpenAI│
                          ┌───────────────────▼──────┐  │  · e-mail / push │
       Railway ───────▶   │   WORKERS (BullMQ)        │  └──────────────────┘
                          │  · bank-sync              │
                          │  · insight-generation     │◀── cron diário
                          │  · alerts / anomalies     │
                          │  · reports (PDF/XLSX)      │
                          │  · forecasting            │
                          └───────────────────────────┘
```

## 3. Por que API separada do Next.js (e não Next API routes)

Decisão de CTO: **backend dedicado**, não serverless dentro do Next. Motivos:

1. **Processamento assíncrono pesado e contínuo** — sync bancário, geração diária de
   insights, forecasting, geração de relatórios. Serverless (Vercel Functions) tem timeout
   curto e não é lar natural de workers/filas de longa duração.
2. **Webhooks e conexões persistentes** — Open Finance (Pluggy) envia webhooks; alertas
   podem usar SSE/WebSocket. Mais simples num serviço always-on.
3. **Clean Architecture de verdade** — domínio isolado, testável, sem acoplar regra de
   negócio a handlers de framework de UI.
4. **Escala independente** — a API e os workers escalam separado da renderização web.

O Next.js continua fazendo o que faz de melhor: SSR/RSC, ótimo LCP, e uma camada fina de
BFF quando conveniente (proxy de cookies), sem lógica de domínio.

## 4. Clean Architecture na API (camadas)

```
Interface   → Controllers HTTP, DTOs, Guards, validação (só entrada/saída)
Application → Use-cases (orquestração), Ports (interfaces de repositório/serviço)
Domain      → Entidades, Value Objects (ex.: Money), regras puras — ZERO dependência de infra
Infrastructure → Prisma (adapters de repositório), LLM, Pluggy, e-mail, storage
```

Regra de dependência: **de fora para dentro**. Domain não conhece Prisma; a Application
define a interface `TransactionRepository`, a Infra implementa com Prisma. Isso permite
trocar ORM, provedor de OF ou LLM sem tocar em regra de negócio.

## 5. Multi-tenant: pessoa física **e** empresa no mesmo modelo

Conceito central: **Workspace**. Todo dado financeiro pertence a um `Workspace`, que tem um
`type`:

- `PERSONAL` → finanças pessoais de um usuário
- `BUSINESS` → empresa (habilita DRE, centro de custos, contas a pagar/receber, pró-labore)

Um `User` participa de N workspaces via `Membership` (com `role`: OWNER/ADMIN/MEMBER/VIEWER).
Isso já entrega, de graça: "pessoa física e empresa", múltiplas empresas, contador com acesso
de leitura, sócios compartilhando a mesma empresa. **Todo query é escopado por
`workspaceId`** — invariante de segurança verificada por um Guard.

## 6. Fluxos-chave

### 6.1 Sincronização bancária (Open Finance / Pluggy)
```
Usuário conecta banco → Pluggy Connect → webhook "item/updated"
  → enfileira job bank-sync(workspaceId, itemId)
  → worker busca contas/transações/cartões via Pluggy
  → normaliza → deduplica → grava Transactions (status: CLEARED)
  → dispara job insight-generation(workspaceId)
```

### 6.2 Geração diária de inteligência (o coração do produto)
```
Cron 06:00 (por timezone do workspace)
  → insight-generation(workspaceId)
  → motor determinístico calcula: score, projeções, anomalias, oportunidades
  → grava Insights (numéricos, auditáveis)
  → LLM recebe SÓ os números + contexto → gera narrativa/priorização
  → grava "Central de Inteligência do dia"
  → se houver item crítico → cria Alert/Notification
```

### 6.3 Copiloto (chat) — RAG sobre dados próprios
```
Pergunta → recupera métricas relevantes via ferramentas determinísticas (function calling)
  → LLM responde citando números vindos do motor, nunca inventados
```

## 7. Observabilidade e operação

- **Logs**: `pino` estruturado (JSON), correlação por `requestId`/`workspaceId`.
- **Tracing/erros**: OpenTelemetry + Sentry (front e back).
- **Métricas de produto**: eventos internos (insight aberto, alerta acionado).
- **Health checks**: `/health` (liveness) e `/health/ready` (DB+Redis).

## 8. Ambientes

`local` (Docker Compose: Postgres+Redis) → `preview` (por PR) → `staging` → `production`.
Migrations Prisma versionadas; nunca `db push` em produção.
