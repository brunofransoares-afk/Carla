/*
 * Bateria do preço por tipo de consulta.
 *
 * Três tipos, três valores (decisão do Dr. Bruno, 10/09/2026): urgência R$ 350 (R$ 600 no
 * fim de semana, e é a única que existe lá; nunca por teleconsulta), puericultura R$ 450,
 * investigação/acompanhamento de neurodesenvolvimento R$ 550. Sem preço de irmãos.
 *
 * A tabela mora aqui e só aqui: o valor que a Carla escreve é lido de volta e conferido
 * antes de reservar. Prompt e código dizendo números diferentes é a Carla travada em loop.
 *
 * Roda com:  node tests/preco-da-consulta.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { precoDaConsulta, valoresConhecidos, permiteTeleconsulta, ehFimDeSemana, TIPOS } = require("../preco-da-consulta.js");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }
const slot = (date, time = "10:00") => ({ date, time });
const SEG = slot("2026-09-14"), SAB = slot("2026-09-12"), DOM = slot("2026-09-13");

// ------------------------------------------------- 1. a tabela
{
  eq(precoDaConsulta(SEG, "urgencia").centavos, 35000, "1. urgência: R$ 350");
  eq(precoDaConsulta(SEG, "puericultura").centavos, 45000, "1b. puericultura: R$ 450");
  eq(precoDaConsulta(SEG, "tnd").centavos, 55000, "1c. neurodesenvolvimento: R$ 550");
  eq(precoDaConsulta(SEG, "puericultura").reais, "R$ 450,00", "1d. texto em reais, com vírgula");
  ok(/urgência/.test(TIPOS.urgencia.nome) && /puericultura/.test(TIPOS.puericultura.nome) && /neurodesenvolvimento/.test(TIPOS.tnd.nome),
    "1e. cada tipo tem o nome que a família ouve");
  ok(Object.keys(TIPOS).length === 3, "1f. três tipos, nem mais nem menos");
}

// ------------------------------------------------- 2. fim de semana: só urgência, R$ 600
{
  eq(precoDaConsulta(SAB, "urgencia").centavos, 60000, "2. urgência no sábado: R$ 600");
  eq(precoDaConsulta(DOM, "urgencia").centavos, 60000, "2b. e no domingo");
  ok(precoDaConsulta(SAB, "urgencia").fimDeSemana, "2c. marcada como fim de semana");
  const p = precoDaConsulta(SAB, "puericultura");
  ok(p.valido === false && /só tem consulta de urgência/.test(p.motivoInvalido), "2d. puericultura no sábado NÃO existe, e diz por quê");
  ok(precoDaConsulta(DOM, "tnd").valido === false, "2e. neurodesenvolvimento no domingo idem");
  ok(!("centavos" in p), "2f. inválido não tem preço: ninguém cobra o que não existe");
}

// ------------------------------------------------- 3. teleconsulta
{
  ok(!permiteTeleconsulta("urgencia"), "3. urgência não existe por vídeo");
  ok(permiteTeleconsulta("puericultura") && permiteTeleconsulta("tnd"), "3b. puericultura e neurodesenvolvimento sim");
  ok(!permiteTeleconsulta("x"), "3c. tipo desconhecido não");
}

// ------------------------------------------------- 4. tipo desconhecido não é preço
{
  const p = precoDaConsulta(SEG, "consulta");
  ok(p.valido === false && /desconhecido/.test(p.motivoInvalido), "4. tipo fora da tabela é inválido, com motivo");
  ok(precoDaConsulta(SEG, undefined).valido === false, "4b. sem tipo também");
  ok(precoDaConsulta({}, "puericultura").valido && precoDaConsulta({}, "puericultura").centavos === 45000,
    "4c. data ilegível cai em dia de semana, nunca no mais caro");
}

// ------------------------------------------------- 5. os valores que a máquina reconhece
{
  eq(valoresConhecidos().join(","), "35000,45000,55000,60000", "5. exatamente os quatro valores que existem");
  for (const d of ["2026-09-12", "2026-09-13"]) ok(ehFimDeSemana(slot(d)), `5b. ${d} é fim de semana`);
  ok(!ehFimDeSemana(SEG), "5c. segunda não é");
}

// ------------------------------------------------- 6. quem usa isso é quem cria a cobrança
{
  const fonte = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
  ok(/Preco\.precoDaConsulta\(slotFinal, tipoConsulta\)/.test(fonte), "6. o valor da cobrança vem daqui, pelo tipo");
  ok(!/precoDoGrupo|criancasJuntas/.test(fonte), "6b. o preço de grupo de irmãos não existe mais em lugar nenhum");
}

console.log(erros.map((e) => "  FALHA " + e).join("\n"));
console.log(`preco-da-consulta: ${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
