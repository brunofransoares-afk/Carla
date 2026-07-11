# Aurora — Plataforma de Inteligência Financeira

> **Codinome de trabalho: `Aurora`.** O nome comercial ainda não foi definido — troque livremente.
> Toda a documentação usa `@aurora/*` como escopo dos pacotes; renomear é um `find & replace`.

SaaS premium de gestão financeira para **pessoas físicas e empresas**, com um **copiloto
financeiro** como diferencial central: em vez de só responder perguntas, o sistema analisa
os dados continuamente e entrega valor mesmo quando o usuário não interage com ele.

## Por que este projeto existe

O mercado (ex.: Finest Financeiro) já resolve "organizar receitas e despesas". Nosso
diferencial não é ter as mesmas telas — é a **Central de Inteligência**: um painel diário
que responde, sem o usuário perguntar:

- O que merece sua atenção **hoje**
- O que **mudou desde ontem**
- Quais contas podem causar **problema de caixa**
- Onde há **oportunidade de economia**
- Como o **patrimônio evoluiu**
- Projeções de **30 / 90 / 365 dias**
- Um **score de saúde financeira**
- Recomendações **priorizadas por impacto**

## Princípio de engenharia que define o produto

> **A IA narra e recomenda. Ela NUNCA calcula dinheiro.**

Todo número (saldo, projeção, score, "você gastou 18% acima da média") é produzido por um
**motor determinístico** (SQL + estatística + regras). O LLM apenas transforma esses
números em linguagem e prioriza recomendações. Isso elimina a maior falha dos concorrentes
com IA: alucinar valores financeiros. Ver `docs/06-INTELLIGENCE-ENGINE.md`.

## Documentação de planejamento (leia nesta ordem)

| Documento | Conteúdo |
|-----------|----------|
| [`docs/01-ARCHITECTURE.md`](docs/01-ARCHITECTURE.md) | Visão de arquitetura, componentes, fluxos, multi-tenant |
| [`docs/02-TECH-DECISIONS.md`](docs/02-TECH-DECISIONS.md) | Escolha de cada tecnologia + onde eu questiono o brief |
| [`docs/03-DATABASE.md`](docs/03-DATABASE.md) | Modelo de dados completo (Prisma) |
| [`docs/04-FOLDER-STRUCTURE.md`](docs/04-FOLDER-STRUCTURE.md) | Estrutura de pastas (monorepo + Clean Architecture) |
| [`docs/05-RISKS-AND-IMPROVEMENTS.md`](docs/05-RISKS-AND-IMPROVEMENTS.md) | Riscos técnicos + melhorias propostas |
| [`docs/06-INTELLIGENCE-ENGINE.md`](docs/06-INTELLIGENCE-ENGINE.md) | Desenho do copiloto e da Central de Inteligência |
| [`ROADMAP.md`](ROADMAP.md) | Fases do projeto |
| [`TASKS.md`](TASKS.md) | Checklist executável, atualizado a cada etapa |

## Status atual

**Fase 0 — Planejamento.** Nenhum código de aplicação foi escrito ainda (por decisão de
processo: arquitetura antes de código). A implementação começa após validação do plano.
