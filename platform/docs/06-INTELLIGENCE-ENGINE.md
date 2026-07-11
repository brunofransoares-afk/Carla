# 06 — Motor de Inteligência & Copiloto

Este é o diferencial do produto. Duas camadas, propósito diferente:

```
┌─────────────────────────────────────────────────────────────┐
│  CAMADA 1 — MOTOR DETERMINÍSTICO  (calcula, é a verdade)     │
│  SQL + estatística + regras. Zero LLM. Auditável.           │
│  → produz: FinancialScore, Forecast, Insight[], Alert[]      │
└───────────────────────────────┬─────────────────────────────┘
                                │  (só números + contexto)
┌───────────────────────────────▼─────────────────────────────┐
│  CAMADA 2 — LLM  (narra, prioriza, conversa)                 │
│  Claude/OpenAI. Recebe os números prontos. NUNCA os inventa. │
│  → produz: texto da Central de Inteligência, respostas do chat│
└─────────────────────────────────────────────────────────────┘
```

**Regra de ouro:** se um número aparece na tela, ele veio da Camada 1 e é rastreável ao dado
que o originou (`Insight.metrics`). O LLM só reescreve em linguagem humana e ordena por impacto.

## Camada 1 — como cada sinal é calculado (determinístico)

| Sinal | Método | Exemplo de saída |
|-------|--------|------------------|
| Gasto acima da média | média móvel por categoria (últimos N meses) + desvio | "Delivery 18% acima da média de 3 meses" |
| Risco de caixa | projeção de saldo (recorrências + agendados + fatura) | "Saldo fica negativo em ~14 dias" |
| Fatura fechando/vencendo | `Card.closingDay`/`dueDay` vs. hoje | "Nubank fecha em 3 dias" |
| Antecipar parcela? | valor presente vs. custo de oportunidade | "Antecipar rende R$X" |
| Oportunidade de economia | detecção de assinaturas/recorrências + outliers | "3 assinaturas somam R$X/mês" |
| Evolução de patrimônio | Σ Assets − Σ Liabilities, série temporal | "Patrimônio +7% no mês" |
| Capacidade de investir | sobra projetada após compromissos + reserva alvo | "Sobra ~R$2.500 este mês" |
| Score de saúde | ver abaixo | 0–100 |

### Score de Saúde Financeira (0–100)
Média ponderada de subcomponentes normalizados, guardado em `FinancialScore.breakdown`:
- **Liquidez** — saldo vs. despesas mensais (meses de fôlego)
- **Endividamento** — dívidas/renda; uso de limite de cartão
- **Taxa de poupança** — (receita − despesa) / receita
- **Reserva de emergência** — progresso vs. alvo (ex.: 6× despesa)
- **Regularidade** — contas em dia vs. atrasadas
- **Tendência** — direção do saldo/patrimônio

Pesos versionados (transparência). Empresa usa variante: margem, ciclo de caixa, previsibilidade.

### Forecasting (sem precisar de time de ML no início)
1. **Base determinística**: projeta recorrências conhecidas + parcelas + faturas + contas a
   pagar/receber → a maior parte do fluxo futuro já é *conhecida*, não "previsão".
2. **Componente estatístico**: sazonalidade + média móvel para gastos variáveis.
3. **Incerteza**: Monte Carlo sobre os variáveis → banda (p10/p50/p90) em vez de linha única.
4. Evolução futura: modelos ML só quando houver dados suficientes; a arquitetura já isola isso.

## Central de Inteligência (a tela)

Gerada 1×/dia por workspace (job `insight-generation`, cron por timezone) e sob demanda.
Estrutura fixa, preenchida pela Camada 1 e narrada pela Camada 2:

1. **O que merece atenção hoje** — top insights por `severity` × `impactCents`.
2. **O que mudou desde ontem** — diff de score, saldo, novas transações relevantes.
3. **Contas que podem causar problema** — vencimentos + risco de caixa.
4. **Oportunidades de economia** — outliers/assinaturas.
5. **Evolução do patrimônio** — série + variação %.
6. **Projeções 30 / 90 / 365** — do `Forecast` com banda de incerteza.
7. **Score de saúde** — com breakdown clicável.
8. **Recomendações priorizadas por impacto** — cada uma com "por quê" rastreável.

Valor entregue **mesmo sem o usuário perguntar nada** → aumenta uso recorrente e retenção.

## Camada 2 — Copiloto (chat)

- **RAG sobre dados próprios via function calling**: o LLM não recebe o banco inteiro; recebe
  **ferramentas** (`getSpendingByCategory`, `getForecast`, `getCardInvoice`...) que executam
  queries determinísticas e devolvem números. O modelo só compõe a resposta.
- **Guardrails**: linguagem de apoio, não "consultoria de investimento" formal; disclaimers;
  recusa de pedidos fora de escopo; toda afirmação numérica citando a ferramenta que a produziu.
- **Custo controlado**: insights diários são gerados em batch e cacheados; o chat só chama LLM
  na interação. Provider abstrato (Claude primário, OpenAI fallback) — sem lock-in.

## Por que esta separação é decisão de CTO, não detalhe

- **Confiabilidade**: elimina a alucinação de valores — o pior erro possível num app financeiro.
- **Auditabilidade** (LGPD/confiança): todo insight tem `metrics` que o justificam.
- **Custo**: não pagamos LLM por número; pagamos por narrativa/conversa.
- **Testabilidade**: a Camada 1 é testável com asserts numéricos exatos; a Camada 2 é opcional
  e degradável (se o LLM cair, os números continuam na tela).
