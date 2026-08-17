/*
 * Bateria de "quem tem consulta marcada não é estranho".
 *
 * Caso real, 08:30. A Carla tinha mandado o lembrete às 08:03 ("hoje é o dia da consulta
 * de Pedro Sassi, às 9h30"). A família respondeu "Bom dia!" e recebeu de volta a
 * apresentação de contato novo: "Aqui é a Carla, secretária do Dr. Bruno Soares,
 * pediatra. Como posso te ajudar hoje?" — 27 minutos depois do lembrete, no dia da
 * consulta.
 *
 * Duas causas somadas:
 *   1. ehPacienteConhecido só olhava contato salvo no celular e lista manual. Quem marcou
 *      consulta PELA CARLA não contava, então era tratado como desconhecido.
 *   2. O histórico da conversa de ontem tinha expirado (4 horas), então não sobrou nada
 *      no contexto dizendo que aquela família já era atendida.
 *
 * Roda com:  node tests/quem-tem-consulta.test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const RAIZ = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "carla-teste-")), "bot");
fs.mkdirSync(path.join(RAIZ, "data"), { recursive: true });
fs.copyFileSync(path.join(__dirname, "..", "storage-node.js"), path.join(RAIZ, "storage-node.js"));
fs.symlinkSync(path.join(__dirname, "..", "..", "carla-app"), path.join(RAIZ, "..", "carla-app"));

const Storage = require(path.join(RAIZ, "storage-node.js"));

const FAMILIA = "+5519982840580";
const DESCONHECIDO = "+5519911112222";
const HOJE = "2026-07-30";
const AGORA = new Date("2026-07-30T08:30:00-03:00");
const slot = (id, data, time) => ({ id, date: data, time, label: `consulta (${data}) às ${time}` });

Storage.reservar({ slot: slot("s-hoje", HOJE, "09:30"), responsavel: "Guilherme", crianca: "Pedro Sassi", telefone: FAMILIA });

// ------------------------------------------------- 1. o caso que aconteceu
{
  ok(Storage.ehPacienteConhecido(FAMILIA) === true,
    "1. quem tem consulta marcada é reconhecido, mesmo sem estar salvo nos contatos");
  ok(Storage.ehPacienteConhecido(DESCONHECIDO) === false,
    "1. quem nunca marcou nada continua sendo contato novo");
}

// ------------------------------------------------- 2. a consulta de hoje
{
  const c = Storage.proximaConsultaDoTelefone(FAMILIA, AGORA);
  ok(c && c.crianca === "Pedro Sassi", "2. acha a consulta desse telefone");
  eq(c.data, HOJE, "2. é a de hoje");
  eq(Storage.proximaConsultaDoTelefone(DESCONHECIDO, AGORA), null, "2. telefone sem consulta devolve null");
}

// ------------------------------------------------- 3. consulta que já passou não conta
{
  const OUTRO = "+5519933334444";
  Storage.reservar({ slot: slot("s-velho", "2026-07-01", "08:00"), responsavel: "Ana", crianca: "Antigo", telefone: OUTRO });
  eq(Storage.proximaConsultaDoTelefone(OUTRO, AGORA), null,
    "3. consulta do mês passado não é 'próxima consulta'");
  ok(Storage.ehPacienteConhecido(OUTRO) === true,
    "3. mas quem já foi atendido continua sendo conhecido pra sempre");
}

// ------------------------------------------------- 4. a mais próxima entre várias
{
  Storage.reservar({ slot: slot("s-longe", "2026-09-10", "14:00"), responsavel: "Guilherme", crianca: "Irmão", telefone: FAMILIA });
  const c = Storage.proximaConsultaDoTelefone(FAMILIA, AGORA);
  eq(c.crianca, "Pedro Sassi", "4. entre duas futuras, devolve a mais próxima");
}

// ------------------------------------------------- 5. marcado à mão como não-paciente ganha
{
  Storage.desmarcarPacienteManual(FAMILIA);
  ok(Storage.ehPacienteConhecido(FAMILIA) === false,
    "5. o Dr. Bruno marcar como não-paciente continua valendo mais que ter consulta");
}

fs.rmSync(path.dirname(RAIZ), { recursive: true, force: true });
console.log(erros.map((e) => "  FALHA " + e).join("\n"));
console.log(`quem-tem-consulta: ${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
