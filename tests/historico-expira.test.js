/*
 * Bateria do prazo de validade do histórico da conversa.
 *
 * Caso real: a família falou com a Carla às 14h47 (consulta do Eduardo) e voltou às 20h57
 * pedindo consulta pra Lis. O histórico guardava as últimas 24 mensagens SEM olhar quando
 * foram, então a Carla continuou o assunto da tarde:
 *
 *   20:57  família  "Boa noite. Gostaria de agendar pra lis soares"
 *   20:57  Carla    "Boa noite! Como prefere pagar: Pix ou cartão?"   <- pendência do Eduardo
 *   20:58  família  "Mas qual data?"
 *   20:58  Carla    "Quinta-feira, dia 30/07, às 11h"                 <- data do Eduardo
 *   21:00  família  "Quinta"
 *   21:01  Carla    confirmou agendamento pro EDUARDO, não pra Lis
 *
 * O último passo é o grave: criou consulta de verdade pra criança errada, com o nome lido
 * do histórico velho. Por isso o corte é por tempo, no código, e não uma regra de prompt.
 *
 * Roda com:  node tests/historico-expira.test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }

const RAIZ = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "carla-teste-")), "bot");
fs.mkdirSync(path.join(RAIZ, "data"), { recursive: true });
fs.copyFileSync(path.join(__dirname, "..", "storage-node.js"), path.join(RAIZ, "storage-node.js"));
fs.copyFileSync(path.join(__dirname, "..", "arquivo-atomico.js"), path.join(RAIZ, "arquivo-atomico.js"));
const IRMA = path.join(RAIZ, "..", "carla-app", "js");
fs.mkdirSync(IRMA, { recursive: true });
fs.writeFileSync(path.join(IRMA, "config.js"), "global.CARLA_CONFIG = global.CARLA_CONFIG || {};\n");
fs.writeFileSync(path.join(IRMA, "agenda.js"), "module.exports = {};\n");

const Storage = require(path.join(RAIZ, "storage-node.js"));

const AGORA = new Date("2026-07-29T20:57:00-03:00");
const horasAtras = (h) => new Date(AGORA.getTime() - h * 60 * 60 * 1000).toISOString();
const comHistorico = (h) => ({ historico: [{ role: "user", content: "oi" }], ultimaAtividade: horasAtras(h) });

// ------------------------------------------------- o caso que aconteceu
ok(Storage.historicoExpirou(comHistorico(6.2), AGORA) === true,
  "as 6h de silêncio do caso real expiram o histórico");

// ------------------------------------------------- pausas normais de atendimento
ok(Storage.historicoExpirou(comHistorico(0), AGORA) === false, "mensagem agorinha não expira");
ok(Storage.historicoExpirou(comHistorico(0.05), AGORA) === false, "3 minutos não expira");
ok(Storage.historicoExpirou(comHistorico(1), AGORA) === false, "1 hora não expira");
ok(Storage.historicoExpirou(comHistorico(3.9), AGORA) === false, "3h54 ainda é a mesma conversa");

// ------------------------------------------------- a borda das 4 horas
ok(Storage.historicoExpirou(comHistorico(4), AGORA) === false, "exatamente 4h ainda não expira");
ok(Storage.historicoExpirou(comHistorico(4.01), AGORA) === true, "passando de 4h expira");
ok(Storage.historicoExpirou(comHistorico(30), AGORA) === true, "conversa de ontem expira");

// ------------------------------------------------- nada pra descartar
ok(Storage.historicoExpirou(null, AGORA) === false, "sessão inexistente não quebra");
ok(Storage.historicoExpirou({}, AGORA) === false, "sessão sem histórico nem data não quebra");
ok(Storage.historicoExpirou({ historico: [], ultimaAtividade: horasAtras(50) }, AGORA) === false,
  "histórico já vazio não precisa expirar");
ok(Storage.historicoExpirou({ historico: [{ role: "user", content: "oi" }] }, AGORA) === false,
  "sem ultimaAtividade não dá pra saber a idade, então não descarta");
ok(Storage.historicoExpirou({ historico: [{ role: "user", content: "oi" }], ultimaAtividade: "data-torta" }, AGORA) === false,
  "data inválida não descarta o histórico por acidente");

// ------------------------------------------------- carimbo no futuro (relógio torto)
ok(Storage.historicoExpirou(comHistorico(-2), AGORA) === false,
  "carimbo no futuro não expira (diferença negativa)");

fs.rmSync(path.dirname(RAIZ), { recursive: true, force: true });
console.log(erros.map((e) => "  FALHA " + e).join("\n"));
console.log(`historico-expira: ${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
