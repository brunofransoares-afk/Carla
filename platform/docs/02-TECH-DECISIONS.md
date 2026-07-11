# 02 — Decisões de Tecnologia (com justificativa e questionamentos)

Formato ADR resumido. Onde eu discordo ou refino o brief, marco **[QUESTIONO O BRIEF]**.

## Monorepo

- **Turborepo + pnpm workspaces.**
  Por quê: front e back compartilham **tipos** (contratos de API, enums de categoria,
  formato de Money). Um único PR muda schema→API→UI de forma atômica e o cache do Turbo
  deixa o CI rápido. `pnpm` pela eficiência de disco e workspaces first-class.

## Frontend

- **Next.js (App Router) + React + TypeScript.** RSC reduz JS no cliente → dashboards mais
  rápidos. TypeScript é inegociável num sistema financeiro.
- **TailwindCSS + shadcn/ui.** shadcn dá componentes acessíveis que **possuímos** (código no
  repo, não um pacote fechado) — essencial para o visual premium custom (Stripe/Linear/Raycast).
- **Framer Motion** para microinterações (nível Raycast), com moderação.
- **Recharts** para gráficos. **[QUESTIONO O BRIEF — leve]**: Recharts é ótimo para o comum;
  para gráficos densos/financeiros específicos (candles, waterfall de DRE) podemos precisar de
  `visx`/`d3` pontualmente. Mantemos Recharts como padrão e abrimos exceção só quando doer.
- **TanStack Query** (não estava no brief) para cache/estado de servidor — evita reinventar
  fetching, retry, invalidação. **Melhoria proposta.**

## Backend

- **NestJS** (não Express puro). **[DECISÃO — o brief deixou "escolha o melhor"]**
  Por quê: para um domínio grande e time crescente, NestJS entrega DI, módulos, guards,
  interceptors, pipes de validação e uma estrutura que **encaixa na Clean Architecture** sem
  reinventar. Express puro significaria reconstruir tudo isso à mão. NestJS roda sobre
  Express/Fastify de qualquer forma. Custo: curva de aprendizado — aceitável.
- **Prisma ORM.** DX excelente, migrations versionadas, tipos gerados.
  **[QUESTIONO O BRIEF — importante]**: para **agregações financeiras pesadas** (DRE, fluxo
  anual, projeções) Prisma pode ficar limitado. Estratégia: Prisma para CRUD/transacional +
  **SQL cru e/ou views materializadas** para relatórios analíticos. Isolado atrás de
  repositórios, então não vaza para o domínio.
- **BullMQ + Redis** (não estava explícito) para jobs. **Melhoria proposta** — indispensável
  para sync, insights e relatórios sem travar requisições.

## Dinheiro — a decisão mais importante do sistema

- **Nunca usar `float`/`Number` para valores monetários.**
  Armazenar como **inteiro em centavos (`BigInt`)** + código de moeda (`currency`), e operar
  com um Value Object `Money`. Toda entrada/saída passa por ele. Isso previne a classe de bug
  mais cara de um app financeiro (arredondamento). Documentado no domínio.

## Banco de dados

- **PostgreSQL.** Escolha certa: transações ACID, `NUMERIC`, JSONB (payload de OF), particionamento
  futuro da tabela `transactions`, views materializadas para relatórios.
- Extensões: `pg_trgm` (busca de transações), `uuid-ossp`/`pgcrypto`.

## Autenticação

- **JWT de acesso curto (15 min) + Refresh Token rotacionado** guardado em **cookie httpOnly
  Secure SameSite=Lax**; refresh persistido com hash no banco (permite revogação/logout global).
- **OAuth Google** via provider dedicado.
- Hash de senha: **Argon2id** (melhor que bcrypt hoje).
- **[QUESTIONO O BRIEF — estratégico]**: dá pra usar auth gerenciada (Clerk/Auth0/Supabase
  Auth) e reduzir superfície de risco. Como você pediu JWT/refresh/OAuth explicitamente,
  implementamos in-house com boas práticas — mas registro que auth gerenciada é uma troca
  válida "menos controle, menos risco/менос código". Decisão reversível atrás de um módulo `Auth`.

## IA / LLM

- **Camada de abstração `LlmProvider`** com **Claude como primário** (raciocínio/narrativa) e
  **OpenAI como fallback + embeddings**. Nunca acoplar o produto a um provider.
- **[QUESTIONO O BRIEF — o ponto mais importante do produto]**: a IA **não deve calcular
  dinheiro**. Ver `06-INTELLIGENCE-ENGINE.md`. Motor determinístico calcula; LLM narra. Isso
  também **corta custo** (não chamamos LLM para cada número) e permite auditar cada insight.
- Guardrails: nunca dar recomendação como "consultoria de investimento" formal — linguagem de
  apoio + disclaimers; toda recomendação rastreável ao dado que a originou.

## Integrações Open Finance

- **[QUESTIONO O BRIEF — importante]**: o brief lista Pluggy **e** Belvo **e** Celcoin. Integrar
  os três de cara é desperdício e risco. Proposta:
  - **Pluggy como agregador primário** (melhor cobertura Brasil, DX forte, sandbox bom).
  - **Abstração `BankingProvider`** para plugar Belvo/Celcoin depois sem reescrever.
  - Celcoin é mais "BaaS/pagamentos" que agregação — só entra se quisermos emitir boleto/PIX.
- Tokens/credenciais de banco: **criptografados em repouso** (libsodium/KMS), nunca em texto.

## Gráficos, Relatórios, Notificações

- Relatórios **PDF** (Puppeteer ou `@react-pdf`), **Excel** (`exceljs`), **CSV** (stream).
  Gerados em worker, entregues por link assinado (não bloqueia request).
- Notificações: e-mail (Resend/Postmark) + push web; canal WhatsApp é opção futura.

## Hospedagem — refino do brief

- **[QUESTIONO O BRIEF]**: o brief cita Vercel + Railway + Supabase juntos. Recomendação
  enxuta e sem redundância:
  - **Web (Next.js) → Vercel** (nativo).
  - **API + Workers + Redis → Railway** (always-on, fácil).
  - **PostgreSQL gerenciado → um só**: Neon ou Supabase (Postgres). Usamos Prisma, então de
    Supabase aproveitamos só Postgres/Storage — não o SDK. **Escolher UM** para não fragmentar.
  - Decisão final de infra fica em `docs/05` como risco/custo a validar com você.

## Qualidade / DevEx (melhorias propostas, não estavam no brief)

- ESLint + Prettier + **type-check** no CI; **Husky + lint-staged** em commits.
- Testes: **Vitest** (unit), **Supertest** (API), **Playwright** (E2E).
- **Zod** para validação de contratos compartilhados front/back.
- CI: GitHub Actions (lint → typecheck → test → build).
- Commits: Conventional Commits + Changesets (versionamento de pacotes internos).
