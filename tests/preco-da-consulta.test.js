/*
 * Bateria do preço da consulta.
 *
 * O Dr. Bruno perguntou: "quando a pessoa marca de fim de semana, como vai cobrar 800?"
 *
 * A pergunta expôs um buraco. A grade padrão não tem sábado nem domingo, e quando a família
 * pergunta sobre fim de semana a Carla escala em vez de marcar — esse caminho está certo.
 * Mas adicionarHorarioExtra não tem trava de dia: ele abre um extra num sábado pelo painel,
 * o horário entra na roda como qualquer outro, e a Carla marcava cobrando R$ 550.
 *
 * Enquanto o preço era só texto do prompt, errar era mandar uma frase errada. Depois que ela
 * passou a gerar cobrança de verdade, errar virou cobrar o valor errado de uma família.
 *
 * Roda com:  node tests/preco-da-consulta.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { precoDaConsulta, ehFimDeSemana } = require(path.join(__dirname, "..", "preco-da-consulta.js"));

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

// 03/08/2026 seg, 04 ter, 05 qua, 06 qui, 07 sex, 08 SÁB, 09 DOM, 10 seg.
const slot = (date, time = "08:00") => ({ date, time });

// ------------------------------------------------- 1. dia de semana
{
  for (const d of ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"]) {
    const p = precoDaConsulta(slot(d));
    eq(p.centavos, 55000, `1. ${d} é dia de semana: R$ 550,00`);
    eq(p.fimDeSemana, false, `1. ${d} não é fim de semana`);
  }
}

// ------------------------------------------------- 2. sábado e domingo
{
  for (const d of ["2026-08-08", "2026-08-09"]) {
    const p = precoDaConsulta(slot(d));
    eq(p.centavos, 80000, `2. ${d} é fim de semana: R$ 800,00`);
    eq(p.fimDeSemana, true, `2. ${d} é fim de semana`);
  }
  eq(precoDaConsulta(slot("2026-08-08")).reais, "R$ 800,00", "2. o texto sai em reais, com vírgula");
  eq(precoDaConsulta(slot("2026-08-03")).reais, "R$ 550,00", "2. e o de semana também");
}

// ------------------------------------------------- 3. o horário do dia não muda nada
{
  // O corte é o DIA, não a hora. Um extra às 18h de sexta continua sendo dia de semana.
  eq(precoDaConsulta(slot("2026-08-07", "18:00")).centavos, 55000, "3. sexta às 18h ainda é R$ 550");
  eq(precoDaConsulta(slot("2026-08-08", "08:00")).centavos, 80000, "3. sábado de manhã já é R$ 800");
}

// ------------------------------------------------- 4. entrada torta não vira preço de fim de semana
// Errar pra R$ 800 numa data que não deu pra ler seria cobrar a mais de quem não devia.
{
  for (const ruim of [{}, { date: null }, { date: "" }, { date: "abacaxi" }, null, undefined]) {
    eq(ehFimDeSemana(ruim), false, `4. ${JSON.stringify(ruim)} não é lido como fim de semana`);
  }
  eq(precoDaConsulta({}).centavos, 55000, "4. e o preço cai no de semana, nunca no mais caro");
}

// ------------------------------------------------- 5. quem usa isso é quem cria a cobrança
{
  const fonte = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
  ok(/Preco\.precoDaConsulta\(slotFinal\)/.test(fonte),
    "5. o valor da cobrança vem daqui, não de uma constante solta");
  ok(!/PRECO_CONSULTA_CENTAVOS \|\| 55000\);/.test(fonte),
    "5. e a constante antiga de valor único saiu do cerebro-ia.js");
}

console.log(erros.map((e) => "  FALHA " + e).join("\n"));
console.log(`preco-da-consulta: ${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
