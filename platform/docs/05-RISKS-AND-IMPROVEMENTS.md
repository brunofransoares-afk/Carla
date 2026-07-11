# 05 — Riscos Técnicos & Melhorias Propostas

## Riscos técnicos (probabilidade × impacto × mitigação)

| # | Risco | Impacto | Mitigação |
|---|-------|---------|-----------|
| R1 | **Precisão monetária** (float/arredondamento) | Crítico | `BigInt` centavos + Value Object `Money`; testes de propriedade; nunca `Float` |
| R2 | **Segurança de dados bancários** (tokens/credenciais) | Crítico | Criptografia em repouso (KMS/libsodium), segredos fora do código, escopo por workspace, RLS opcional |
| R3 | **Alucinação da IA em valores** | Crítico | Motor determinístico calcula; LLM só narra (`docs/06`); disclaimers |
| R4 | **Confiabilidade/limite/custo do agregador** (Pluggy) | Alto | Abstração `BankingProvider`; retries/backoff; sync incremental; monitorar custo por conexão |
| R5 | **Custo de LLM escalando com usuários** | Alto | Insights em batch cacheado, não por request; modelos menores p/ tarefas simples; limites por plano |
| R6 | **Escopo gigante** (o brief é enorme) | Alto | Fatiar em fases (`ROADMAP.md`); MVP vertical antes de largura |
| R7 | **Performance de relatórios/agregações** (DRE, fluxo anual) | Médio | Views materializadas + SQL cru isolado; particionar `transactions` no futuro |
| R8 | **LGPD / conformidade** | Alto | Consentimento, export/delete de dados, `AuditLog`, minimização, retenção definida |
| R9 | **Expectativa de acurácia das previsões** | Médio | Comunicar como faixa (p10–p90), não certeza; explicar o método |
| R10 | **Lock-in de fornecedor** (LLM, OF, host) | Médio | Camadas de abstração; um provider primário + fallback |
| R11 | **Concorrência no saldo** (writes simultâneos) | Médio | Saldo = soma reconciliada por job; transações idempotentes (`externalId`) |
| R12 | **Multi-tenant leak** (vazar dados entre workspaces) | Crítico | Guard global exige `workspaceId`; testes que provam isolamento |

## Melhorias que proponho além do brief

1. **Copiloto proativo (Central de Inteligência)** — já incorporado como núcleo; entrega valor
   sem interação. *(sua ideia — endossada e detalhada em `docs/06`.)*
2. **`packages/contracts` com Zod** — contrato único front/back; elimina divergência.
3. **BullMQ + Redis** — todo trabalho pesado assíncrono; UI nunca bloqueia.
4. **Money como Value Object** — invariante de domínio, não convenção.
5. **Forecast com banda de incerteza (Monte Carlo)** — honesto e diferenciado vs. "linha mágica".
6. **Feature flags + planos (free/pro/business)** desde cedo — monetização e rollout gradual.
7. **Observabilidade desde a Fase 0** (Sentry, OTel, pino) — não é "depois".
8. **Seed realista + ambiente demo** — vender e testar a IA precisa de dados plausíveis.
9. **Design system próprio (`packages/ui`)** — consistência premium Stripe/Linear/Raycast.
10. **Import CSV/OFX** como fallback ao Open Finance — funciona antes de conectar banco.

## Questionamentos ao brief (resumo — detalhe em `docs/02`)

- **Express vs NestJS** → escolhi **NestJS** (encaixa Clean Architecture).
- **3 agregadores (Pluggy+Belvo+Celcoin)** → **um primário (Pluggy)** + abstração; não os três.
- **2 LLMs** → **abstração** com Claude primário + OpenAI fallback, não os dois em paralelo.
- **Vercel+Railway+Supabase** → papéis distintos, **um único Postgres gerenciado**; sem redundância.
- **IA que "faz tudo"** → IA que **narra**; números vêm do motor. Correção central de arquitetura.
- **Auth in-house** → feito com boas práticas, mas registro que auth gerenciada é troca válida.

## Decisões que preciso de você (não bloqueiam o planejamento, mas orientam a Fase 0)

1. **Repositório**: mantenho o SaaS isolado em `platform/` neste repo, ou extraio para um repo
   dedicado? (recomendo dedicado no médio prazo — o repo atual tem o bot "Carla").
2. **Nome comercial** (uso codinome `Aurora` até você definir).
3. **Infra/custo**: confirma Vercel (web) + Railway (api/workers/redis) + Postgres gerenciado
   (Neon **ou** Supabase)? Há orçamento mensal alvo?
4. **Foco do MVP**: começamos por **pessoa física** (mais simples, mercado maior) e empresa vem
   depois? É minha recomendação.
