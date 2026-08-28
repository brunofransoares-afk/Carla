/*
 * Bateria do bolso de dados pendentes — e-mail do responsável e data de nascimento da
 * criança que chegam ANTES de existir agendamento pra ligar.
 *
 * Existe por causa de um caso real: a família mandou "Eduardo, data nascimento 22/02/18"
 * junto com os nomes, a Carla respondeu "Anotado, obrigada" e o dado sumiu, porque o
 * agendamento só nasceu um minuto depois. Como ela já tinha "anotado", a família nunca
 * repetiu a data, e a ficha da criança no prontuário nunca foi criada.
 *
 * Escreve num data/ isolado, nada de rede. Roda com:  node tests/dados-pendentes.test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

// ------------------------------------------------------------------ arnês
// O storage guarda em <raiz>/data. Copia o módulo pra uma raiz temporária pra bateria
// nunca encostar nos dados de verdade do servidor.
const RAIZ = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "carla-teste-")), "bot");
fs.mkdirSync(path.join(RAIZ, "data"), { recursive: true });
fs.copyFileSync(path.join(__dirname, "..", "storage-node.js"), path.join(RAIZ, "storage-node.js"));
fs.copyFileSync(path.join(__dirname, "..", "arquivo-atomico.js"), path.join(RAIZ, "arquivo-atomico.js"));
const IRMA = path.join(RAIZ, "carla-app", "js");
fs.mkdirSync(IRMA, { recursive: true });
fs.writeFileSync(path.join(IRMA, "config.js"), "global.CARLA_CONFIG = global.CARLA_CONFIG || {};\n");
fs.writeFileSync(path.join(IRMA, "agenda.js"), "module.exports = {};\n");

const Storage = require(path.join(RAIZ, "storage-node.js"));

const TEL = "+5519999482403";
const OUTRO = "+5519911112222";
const slot = (id, time) => ({ id, date: "2026-08-20", time, label: "20/08 às " + time });
let reservaS3;

// ---------------------------------------------- 1. dado adiantado não se perde
{
  const r = Storage.registrarDadosDoPaciente(TEL, { dataNascimento: "2018-02-22" });
  ok(r && r.pendente === true, "1. sem agendamento devolve { pendente: true }, não false");
  const guardado = Storage.lerDadosPendentes(TEL);
  eq(guardado && guardado.dataNascimento, "2018-02-22", "1. a data ficou no bolso de pendentes");
}

// ---------------------------------------------- 2. os pedaços se acumulam
{
  Storage.registrarDadosDoPaciente(TEL, { email: "mae@exemplo.com" });
  const guardado = Storage.lerDadosPendentes(TEL);
  eq(guardado.email, "mae@exemplo.com", "2. e-mail entrou depois");
  eq(guardado.dataNascimento, "2018-02-22", "2. e não apagou a data que já estava lá");
}

// ---------------------------------------------- 3. a reserva consome o bolso
{
  const item = Storage.reservar({ slot: slot("s1", "09:00"), responsavel: "Bruno", crianca: "Eduardo", telefone: TEL });
  ok(item && item.slotId && item.agendaSlotId === "s1", "3. reservar devolve o agendamento criado, não true");
  eq(item.criancaDataNascimento, "2018-02-22", "3. a data adiantada entrou no agendamento");
  eq(item.responsavelEmail, "mae@exemplo.com", "3. o e-mail adiantado entrou no agendamento");
  eq(Storage.lerDadosPendentes(TEL), null, "3. o bolso foi esvaziado depois de usado");
}

// ---------------------------------------------- 4. não vaza pra outra consulta
{
  const item = Storage.reservar({ slot: slot("s2", "10:00"), responsavel: "Bruno", crianca: "Outro Filho", telefone: TEL });
  eq(item.criancaDataNascimento, null, "4. a segunda consulta não herda a data da primeira");
  eq(item.responsavelEmail, null, "4. nem o e-mail");
}

// ---------------------------------------------- 5. não vaza pra outra família
{
  Storage.registrarDadosDoPaciente(OUTRO, { email: "outra@exemplo.com" });
  const item = Storage.reservar({ slot: slot("s3", "11:00"), responsavel: "Ana", crianca: "Lis", telefone: TEL });
  reservaS3 = item;
  eq(item.responsavelEmail, null, "5. o bolso de outro telefone não entra aqui");
  const guardado = Storage.lerDadosPendentes(OUTRO);
  eq(guardado && guardado.email, "outra@exemplo.com", "5. e continua guardado pra quem é dono dele");
}

// ---------------------------------------------- 6. com irmãos, exige identidade do agendamento
{
  const semAlvo = Storage.registrarDadosDoPaciente(TEL, { email: "depois@exemplo.com", dataNascimento: "2020-05-05" });
  ok(semAlvo && semAlvo.ambiguo === true, "6. com mais de um filho não escolhe o mais recente no escuro");
  const r = Storage.registrarDadosDoPaciente(TEL, { email: "depois@exemplo.com", dataNascimento: "2020-05-05" }, { slotId: reservaS3.slotId });
  ok(r && r.pendente !== true, "6. com agendamento existente NÃO cai no bolso de pendentes");
  eq(r.slotId, reservaS3.slotId, "6. grava no agendamento indicado por slotId");
  eq(r.responsavelEmail, "depois@exemplo.com", "6. e-mail gravado");
  eq(r.criancaDataNascimento, "2020-05-05", "6. data gravada");
}

// ---------------------------------------------- 6b. mesmo dado de novo nao e novidade
// A Carla relia a conversa, achava o e-mail que ELA MESMA tinha escrito e chamava a
// ferramenta outra vez. Cada chamada disparava um WhatsApp pro Dr. Bruno com o mesmo
// recado. Repetido tem que morrer aqui, sem depender do modelo lembrar.
{
  const r = Storage.registrarDadosDoPaciente(TEL, { email: "depois@exemplo.com", dataNascimento: "2020-05-05" }, { slotId: reservaS3.slotId });
  ok(r && r.semNovidade === true, "6b. os dois iguais devolvem semNovidade");
  const r2 = Storage.registrarDadosDoPaciente(TEL, { email: "depois@exemplo.com" }, { slotId: reservaS3.slotId });
  ok(r2 && r2.semNovidade === true, "6b. so o e-mail, igual, também é semNovidade");
  const r3 = Storage.registrarDadosDoPaciente(TEL, { email: "novo@exemplo.com" }, { slotId: reservaS3.slotId });
  ok(r3 && !r3.semNovidade, "6b. e-mail diferente NÃO é semNovidade");
  eq(r3.responsavelEmail, "novo@exemplo.com", "6b. e o novo e-mail foi gravado");
  eq(r3.criancaDataNascimento, "2020-05-05", "6b. sem apagar a data que já estava lá");
}

// ---------------------------------------------- 7. o CSV mostra o que foi adiantado
{
  const csv = fs.readFileSync(path.join(RAIZ, "data", "agendamentos.csv"), "utf8").replace(/^﻿/, "");
  const linha = csv.split("\r\n").find((l) => l.includes("Eduardo"));
  ok(linha && linha.includes('"22/02/2018"'), "7. a data adiantada aparece no CSV, em formato BR");
  ok(linha && linha.includes('"mae@exemplo.com"'), "7. o e-mail adiantado aparece no CSV");
}

// ------------------------------------------------------------------ resultado
Storage._fecharBancoAgendamentosParaTeste();
fs.rmSync(path.dirname(RAIZ), { recursive: true, force: true });
console.log(erros.map((e) => "  FALHA " + e).join("\n"));
console.log(`dados-pendentes: ${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
