# ROADMAP — Aurora (Plataforma de Inteligência Financeira)

> Estratégia: **MVP vertical** (uma fatia completa e bonita) antes de largura. Entregar valor
> cedo, validar a IA, escalar depois. Cada fase termina com algo demonstrável.
> Legenda: ⬜ pendente · 🟨 em andamento · ✅ concluído

## Fase 0 — Fundações ⬜
Objetivo: esqueleto que compila, faz deploy e autentica.
- Monorepo (Turborepo + pnpm), tsconfig/eslint/prettier compartilhados
- `packages/ui` (design system: tema dark premium, tokens, shadcn customizado)
- `packages/db` (schema Prisma inicial + migrations + seed)
- `packages/contracts` (Zod)
- API NestJS: bootstrap, config, health, pino, Sentry/OTel
- Auth: registro/login, JWT + refresh rotacionado, OAuth Google
- Web: shell (sidebar Pessoal/Empresa, tema), páginas de auth
- CI (lint→typecheck→test→build), Docker Compose (Postgres+Redis)
- Deploy: web (Vercel) + api (Railway) + Postgres/Redis
**Entrega:** login funcionando, deploy verde, base sólida.

## Fase 1 — Núcleo financeiro pessoal ⬜
- Workspaces + memberships (Pessoal)
- Contas, Categorias/Subcategorias
- Transações (CRUD, filtros, busca), receitas/despesas
- Contas recorrentes (RecurringRule) + geração
- Dashboard pessoal (saldo, receitas, despesas, fluxo mensal, gráficos)
**Entrega:** app de finanças pessoais utilizável (sem banco conectado).

## Fase 2 — Cartões, parcelamentos, metas ⬜
- Cartões, limite/disponível, fechamento/vencimento
- Faturas (atual/próxima/histórico), parcelas futuras
- Parcelamentos (Installment)
- Metas / cofrinhos + Reserva de emergência
- Patrimônio (Assets/Liabilities) + investimentos manuais
**Entrega:** paridade com o essencial do concorrente (pessoa física).

## Fase 3 — Open Finance (Pluggy) ⬜
- Abstração `BankingProvider` + adapter Pluggy
- Pluggy Connect (conectar banco), webhooks, criptografia de credenciais
- Worker `bank-sync` (contas, transações, cartões, investimentos) idempotente
- Import CSV/OFX (fallback)
**Entrega:** atualização automática de extrato/saldo/cartões.

## Fase 4 — Inteligência & Copiloto ⬜ (o diferencial)
- Motor determinístico: score, anomalias, oportunidades, capacidade de investir
- Forecast 30/90/365 (recorrências + sazonal + Monte Carlo)
- Central de Inteligência (tela) + job diário `insight-generation`
- Copiloto (chat) com function calling sobre o motor; abstração LLM
**Entrega:** produto entrega valor sem o usuário perguntar nada.

## Fase 5 — Empresarial ⬜
- Workspace BUSINESS: centro de custos, contas a pagar/receber
- DRE, fluxo de caixa empresarial, margem/lucro, pró-labore
- Dashboard empresarial + indicadores
**Entrega:** cobre o público empresa.

## Fase 6 — Automações & Alertas ⬜
- Alertas: contas vencendo, cartão fechando, meta atingida, recebimentos, fluxo negativo
- Detecção de anomalias/gastos fora do padrão
- Entrega: e-mail + push; centro de notificações
**Entrega:** sistema age proativamente.

## Fase 7 — Relatórios & Refinos ⬜
- Relatórios PDF/Excel/CSV (mensal/anual/categoria/cartão/conta) via worker
- Comparativos avançados, planejamento financeiro
- Polimento de UX/animações
**Entrega:** relatórios profissionais.

## Fase 8 — Hardening, LGPD, escala, lançamento ⬜
- LGPD: consentimento, export/delete, retenção, `AuditLog` completo
- Segurança: rate limit, pentest básico, revisão de segredos, backups testados
- Performance: views materializadas, índices, cache, particionamento se preciso
- Planos/billing, feature flags, monitoramento de custos (LLM/OF)
**Entrega:** pronto para dezenas de milhares de usuários.

---
### Progresso global
Fase 0 ▶ **planejamento concluído**, implementação não iniciada.
