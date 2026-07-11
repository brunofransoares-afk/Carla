# 04 — Estrutura de Pastas

Monorepo com **Turborepo + pnpm**. Separação total: frontend, backend, domínio, infra,
serviços, IA — cada um com fronteira clara.

```
platform/
├─ apps/
│  ├─ web/                      # Next.js (App Router) — Vercel
│  │  ├─ app/                   # rotas (RSC): (auth), (dashboard), (business)...
│  │  ├─ components/            # UI de tela (compõe o design system)
│  │  ├─ features/              # slices por domínio de tela (transactions, cards, insights)
│  │  ├─ lib/                   # api client, hooks (TanStack Query), utils
│  │  └─ styles/
│  │
│  ├─ api/                      # NestJS — Railway (Clean Architecture)
│  │  └─ src/
│  │     ├─ modules/            # 1 módulo por bounded context
│  │     │  ├─ auth/
│  │     │  ├─ workspaces/
│  │     │  ├─ transactions/
│  │     │  │  ├─ interface/    # controllers, DTOs, guards
│  │     │  │  ├─ application/  # use-cases + ports (interfaces)
│  │     │  │  ├─ domain/       # entidades, VOs, regras puras
│  │     │  │  └─ infrastructure/ # repositórios Prisma, adapters
│  │     │  ├─ accounts/  cards/  categories/  recurring/  installments/
│  │     │  ├─ goals/  assets/  investments/
│  │     │  ├─ business/        # DRE, cost-centers, payables, receivables
│  │     │  ├─ open-finance/    # provider Pluggy + sync
│  │     │  ├─ intelligence/    # motor determinístico (score, forecast, anomalias)
│  │     │  ├─ copilot/         # orquestração LLM (RAG sobre intelligence)
│  │     │  ├─ reports/         # PDF/XLSX/CSV
│  │     │  └─ notifications/
│  │     ├─ shared/             # Money VO, erros, pipes, decorators, guards globais
│  │     └─ main.ts
│  │
│  └─ workers/                  # processos BullMQ (podem reusar módulos da api)
│     └─ src/jobs/              # bank-sync, insight-generation, alerts, reports, forecasting
│
├─ packages/
│  ├─ contracts/                # tipos + schemas Zod compartilhados front/back (API contract)
│  ├─ domain/                   # (opcional) domínio puro reutilizável (Money, enums)
│  ├─ ui/                       # design system (shadcn/ui customizado, tokens, tema)
│  ├─ config/                   # eslint, tsconfig, tailwind preset compartilhados
│  └─ db/                       # schema.prisma, migrations, seed, Prisma Client gerado
│
├─ infra/
│  ├─ docker-compose.yml        # Postgres + Redis locais
│  └─ github/                   # workflows CI/CD
│
├─ docs/                        # esta documentação de planejamento
├─ ROADMAP.md
├─ TASKS.md
├─ turbo.json
├─ pnpm-workspace.yaml
└─ package.json
```

## Regras de fronteira (impostas por lint de imports)

- `domain` **não importa** nada de `infrastructure`, `interface`, Prisma ou Nest.
- `application` importa `domain` e define **ports**; nunca importa Prisma direto.
- `infrastructure` implementa os ports; é o único lugar com Prisma/Pluggy/LLM.
- `web` importa **apenas** `packages/contracts` e `packages/ui` do backend-world — nunca
  código de `apps/api`. O contrato é a fronteira.
- `copilot` depende de `intelligence`, nunca o contrário (IA consome números, não os gera).

## Por que `packages/contracts` é central

Um único lugar define o formato de cada request/response com **Zod**. O back valida a entrada
com o mesmo schema que o front usa para tipar e validar formulários. Fim da divergência
front/back e base para um SDK tipado.
