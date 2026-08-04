/*
 * Bateria do prazo de pagamento.
 *
 * O Dr. Bruno tomou um calote e mudou a regra: ninguém é atendido sem ter pago antes.
 *
 *   consulta à TARDE  ->  dá pra pagar até a manhã do mesmo dia
 *   consulta de MANHÃ ->  tem que estar pago no dia anterior
 *
 * A conta é código porque errar aqui é dizer pra família um prazo que não existe, e ela
 * chegar sem ter pago achando que estava dentro do combinado. Que é o que acabou de custar
 * uma consulta.
 *
 * Roda com:  node tests/prazo-de-pagamento.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { prazoDePagamento } = require(path.join(__dirname, "..", "prazo-de-pagamento.js"));

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const slot = (date, time) => ({ date, time });
// 2026-08-03 é uma segunda-feira. 04/08 terça, 05/08 quarta, 06/08 quinta, 07/08 sexta.
const em = (data, hora) => {
  const [a, m, d] = data.split("-").map(Number);
  const [hh, mm] = hora.split(":").map(Number);
  return new Date(a, m - 1, d, hh, mm);
};

// ------------------------------------------------- 1. consulta de tarde
{
  // Marcando na segunda uma consulta de quinta à tarde: paga até quinta de manhã.
  const r = prazoDePagamento(slot("2026-08-06", "14:00"), em("2026-08-03", "10:00"));
  eq(r.agora, false, "1. tem prazo, não precisa pagar na hora");
  eq(r.texto, "até quinta-feira (06/08) de manhã", "1. o prazo é a manhã do dia da consulta");
}

// ------------------------------------------------- 2. consulta de manhã
{
  // Consulta quinta de manhã: o dinheiro tem que entrar na quarta.
  const r = prazoDePagamento(slot("2026-08-06", "08:00"), em("2026-08-03", "10:00"));
  eq(r.agora, false, "2. tem prazo");
  eq(r.texto, "até quarta-feira (05/08)", "2. consulta de manhã fecha no dia anterior, sem 'de manhã'");
}

// ------------------------------------------------- 3. amanhã
{
  eq(prazoDePagamento(slot("2026-08-04", "15:00"), em("2026-08-03", "18:00")).texto,
    "até amanhã de manhã", "3. consulta amanhã à tarde: paga até amanhã de manhã");
  eq(prazoDePagamento(slot("2026-08-05", "08:00"), em("2026-08-03", "18:00")).texto,
    "até amanhã", "3. consulta depois de amanhã de manhã: paga até amanhã");
}

// ------------------------------------------------- 4. hoje
{
  // Marcou hoje de manhã uma consulta pra hoje à tarde: dá, mas é hoje mesmo.
  const r = prazoDePagamento(slot("2026-08-03", "16:00"), em("2026-08-03", "08:30"));
  eq(r.agora, false, "4. consulta hoje à tarde, marcada de manhã, ainda tem prazo");
  eq(r.texto, "ainda hoje de manhã", "4. e o prazo é hoje de manhã");

  // Consulta amanhã de manhã: o dia anterior é hoje.
  const r2 = prazoDePagamento(slot("2026-08-04", "08:00"), em("2026-08-03", "14:00"));
  eq(r2.agora, false, "4. consulta amanhã de manhã ainda tem prazo hoje");
  eq(r2.texto, "ainda hoje", "4. e o prazo é hoje");
}

// ------------------------------------------------- 5. o prazo já passou: paga na hora
{
  // Consulta hoje à tarde, mas já são 14h: a manhã acabou.
  const r = prazoDePagamento(slot("2026-08-03", "16:00"), em("2026-08-03", "14:00"));
  eq(r.agora, true, "5. consulta hoje à tarde depois do meio-dia: só confirma pagando agora");
  eq(r.texto, "agora", "5. e o texto diz isso");

  // Consulta hoje de manhã: o dia anterior já foi.
  const r2 = prazoDePagamento(slot("2026-08-03", "09:00"), em("2026-08-03", "07:00"));
  eq(r2.agora, true, "5. consulta hoje de manhã: o prazo era ontem, então é agora");
}

// ------------------------------------------------- 6. a fronteira do meio-dia
{
  // 11:59 ainda é manhã da consulta de tarde. 12:00 já não é.
  eq(prazoDePagamento(slot("2026-08-03", "14:00"), em("2026-08-03", "11:59")).agora, false,
    "6. 11:59 ainda está dentro do prazo");
  eq(prazoDePagamento(slot("2026-08-03", "14:00"), em("2026-08-03", "12:00")).agora, true,
    "6. 12:00 em ponto já passou do prazo");

  // E o corte de manhã/tarde da própria consulta é o mesmo meio-dia.
  eq(prazoDePagamento(slot("2026-08-06", "11:59"), em("2026-08-03", "10:00")).texto,
    "até quarta-feira (05/08)", "6. consulta às 11:59 conta como manhã");
  eq(prazoDePagamento(slot("2026-08-06", "12:00"), em("2026-08-03", "10:00")).texto,
    "até quinta-feira (06/08) de manhã", "6. consulta às 12:00 conta como tarde");
}

// ------------------------------------------------- 7. vira o mês e vira a semana
{
  // Consulta terça 01/09 de manhã: o dia anterior é segunda 31/08, outro mês.
  const r = prazoDePagamento(slot("2026-09-01", "08:00"), em("2026-08-28", "10:00"));
  eq(r.texto, "até segunda-feira (31/08)", "7. atravessa a virada de mês sem errar o dia");

  // Consulta segunda de manhã: o dia anterior é domingo, dia em que o consultório não
  // atende. Continua valendo: é prazo do dinheiro, não de atendimento.
  const r2 = prazoDePagamento(slot("2026-08-10", "08:00"), em("2026-08-06", "10:00"));
  eq(r2.texto, "até domingo (09/08)", "7. o prazo pode cair num dia sem atendimento");
}

// ------------------------------------------------- 8. a meia-noite do limite
{
  // 23:59 do dia anterior ainda vale pra consulta de manhã. Meia-noite não.
  eq(prazoDePagamento(slot("2026-08-06", "08:00"), em("2026-08-05", "23:59")).agora, false,
    "8. 23:59 do dia anterior ainda está dentro");
  eq(prazoDePagamento(slot("2026-08-06", "08:00"), em("2026-08-06", "00:00")).agora, true,
    "8. passou da meia-noite, acabou o prazo");
}

// ------------------------------------------------- 9. a trava reconhece as palavras novas
// A Carla parou de dizer "reservado" e passou a dizer "separado". A trava que impede ela de
// dar um horário como certo sem ter chamado a ferramenta olhava só as palavras antigas, e
// teria virado enfeite justamente na regra que o Dr. Bruno acabou de criar.
{
  const fonte = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
  const achado = fonte.match(/const PARECE_CONFIRMACAO_REGEX = (\/.+\/i);/);
  ok(!!achado, "9. achei a trava no código pra poder exercitar de verdade");
  if (achado) {
    const trava = eval(achado[1]);  // eslint-disable-line no-eval
    for (const frase of [
      "Deixei separado para você: quinta-feira (06/08) às 8h.",
      "Deixei guardado pra você esse horário.",
      "Separei o horário aqui!",
      "Deixei reservado para você.",
      "A consulta está confirmada.",
    ]) {
      ok(trava.test(frase), `9. a trava pega "${frase.slice(0, 32)}..."`);
    }
    for (const frase of [
      "Tenho quinta às 8h ou quinta às 14h. Qual fica melhor?",
      "O valor é R$ 550, em Pix ou cartão via link de pagamento.",
      "Vou separar um tempinho pra te explicar como funciona.",
    ]) {
      ok(!trava.test(frase), `9. e não dispara à toa em "${frase.slice(0, 32)}..."`);
    }
  }
}

// ------------------------------------------------- 10. o resto da regra continua escrito
{
  const fonte = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
  ok(/PAGAMENTO ANTES DA CONSULTA, SEM EXCEÇÃO/.test(fonte),
    "10. a regra está no prompt");
  ok(!/em dinheiro, Pix ou cartão/.test(fonte),
    "10. a frase pronta do preço não oferece mais dinheiro");
  ok(!/Pagamento: Pix, dinheiro/.test(fonte),
    "10. e dinheiro saiu das formas de pagamento (só existe presencialmente, no dia)");
  ok(/prazoPagamento/.test(fonte),
    "10. o prazo calculado chega até ela pela ferramenta");

  const storage = fs.readFileSync(path.join(__dirname, "..", "storage-node.js"), "utf8");
  ok(/pago: false/.test(storage), "10. todo agendamento novo nasce como não pago");
  ok(/function marcarPagamento\(slotId, pago\)/.test(storage),
    "10. e existe como o Dr. Bruno virar isso pelo painel");
}

console.log(erros.map((e) => "  FALHA " + e).join("\n"));
console.log(`prazo-de-pagamento: ${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
