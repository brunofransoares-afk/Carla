/*
 * Bateria das buscas que o aviso do portal usa.
 *
 * O prontuário conhece a família pelo E-MAIL (foi o que a Carla mandou pra lá), não pelo
 * telefone do WhatsApp. Então o aviso "o portal da criança foi liberado" chega aqui com
 * um e-mail digitado à mão numa conversa, e precisa achar o agendamento certo mesmo com
 * maiúscula, espaço sobrando ou duas consultas do mesmo telefone.
 *
 * O QUE ESTA BATERIA NÃO COBRE, de propósito: o envio da mensagem no WhatsApp e as duas
 * rotas HTTP. Os dois dependem do processo do bot de pé com a conexão viva, e fingir isso
 * num teste testaria a imitação, não o programa. Aqui ficam só as decisões de dados.
 *
 * Roda com:  node tests/portal-liberado.test.js
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
fs.copyFileSync(path.join(__dirname, "..", "arquivo-atomico.js"), path.join(RAIZ, "arquivo-atomico.js"));
const IRMA = path.join(RAIZ, "carla-app", "js");
fs.mkdirSync(IRMA, { recursive: true });
fs.writeFileSync(path.join(IRMA, "config.js"), "global.CARLA_CONFIG = global.CARLA_CONFIG || {};\n");
fs.writeFileSync(path.join(IRMA, "agenda.js"), "module.exports = {};\n");

const Storage = require(path.join(RAIZ, "storage-node.js"));

const TEL = "+5519999482403";
const SEM_WHATSAPP = "(a confirmar)";
const slot = (id, time) => ({ id, date: "2026-09-10", time, label: "10/09 às " + time });

const reservaA1 = Storage.reservar({ slot: slot("a1", "09:00"), responsavel: "Bruno", crianca: "Eduardo Soares", telefone: TEL });
let reservaA2;
Storage.registrarDadosDoPaciente(TEL, { email: "mae@exemplo.com" });

// ------------------------------------------------- 1. acha pelo e-mail
{
  const a = Storage.acharAgendamentoPorEmail("mae@exemplo.com");
  ok(a && a.slotId === reservaA1.slotId, "1. acha o agendamento pelo e-mail exato");
}

// ------------------------------------------------- 2. e-mail vem digitado à mão
{
  ok(Storage.acharAgendamentoPorEmail("  MAE@Exemplo.COM  "), "2. ignora maiúscula e espaço em volta");
  eq(Storage.acharAgendamentoPorEmail("outra@exemplo.com"), null, "2. e-mail desconhecido devolve null");
  eq(Storage.acharAgendamentoPorEmail(""), null, "2. e-mail vazio devolve null");
  eq(Storage.acharAgendamentoPorEmail(null), null, "2. e-mail nulo devolve null");
}

// ------------------------------------------------- 3. duas consultas, o mesmo e-mail
{
  reservaA2 = Storage.reservar({ slot: slot("a2", "10:00"), responsavel: "Bruno", crianca: "Irmã", telefone: TEL });
  Storage.registrarDadosDoPaciente(TEL, { email: "mae@exemplo.com" }, { slotId: reservaA2.slotId });
  const a = Storage.acharAgendamentoPorEmail("mae@exemplo.com");
  eq(a.slotId, reservaA2.slotId, "3. devolve o agendamento mais recente desse e-mail");
}

// ------------------------------------------------- 4. marca que já avisou
{
  const antes = Storage.acharAgendamentoPorEmail("mae@exemplo.com");
  eq(antes.portalAvisadoEm, undefined, "4. começa sem marca de aviso");
  ok(Storage.marcarPortalAvisado(reservaA2.slotId) === true, "4. marcar devolve true");
  const depois = Storage.acharAgendamentoPorEmail("mae@exemplo.com");
  ok(typeof depois.portalAvisadoEm === "string", "4. a marca ficou gravada");
  eq(Storage.lerAgendamentos().find((x) => x.slotId === reservaA1.slotId).portalAvisadoEm, undefined,
    "4. e não marcou o outro agendamento junto");
}

// ------------------------------------------------- 5. slot inexistente
{
  eq(Storage.marcarPortalAvisado("nao-existe"), false, "5. marcar slot inexistente devolve false");
}

// ------------------------------------------------- 6. telefone que não é WhatsApp
{
  Storage.reservar({ slot: slot("a3", "11:00"), responsavel: "Ana", crianca: "Lis", telefone: SEM_WHATSAPP });
  Storage.registrarDadosDoPaciente(SEM_WHATSAPP, { email: "manual@exemplo.com" });
  const a = Storage.acharAgendamentoPorEmail("manual@exemplo.com");
  ok(a && !String(a.telefone).startsWith("+"),
    "6. agendamento feito na mão é encontrado, e dá pra ver que não tem WhatsApp (quem avisa recusa)");
}

Storage._fecharBancoAgendamentosParaTeste();
fs.rmSync(path.dirname(RAIZ), { recursive: true, force: true });
console.log(erros.map((e) => "  FALHA " + e).join("\n"));
console.log(`portal-liberado: ${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
