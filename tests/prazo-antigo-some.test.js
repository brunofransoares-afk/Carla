/**
 * Auditoria de 10/09, problema 6: a reserva deixou de ter prazo (o pagamento vale até o
 * horário da consulta), mas a mudança só valeu pras reservas NOVAS. As que já estavam no
 * banco continuaram com o prazo antigo gravado, e a rotina de vencimento continuava
 * vencendo elas sozinhas, o que dispara o cancelamento nas integrações.
 *
 * Aqui o banco é montado como ele estava ANTES (política velha), o storage novo é carregado
 * em cima, e o relógio avança. A reserva tem que sobreviver.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
let passou = 0, falhou = 0; const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "carla-prazo-antigo-"));
const RAIZ = path.join(TEMP, "bot");
fs.mkdirSync(path.join(RAIZ, "data"), { recursive: true });
fs.mkdirSync(path.join(RAIZ, "carla-app", "js"), { recursive: true });
for (const f of ["storage-node.js", "arquivo-atomico.js", "grade-teleconsulta.js"]) {
  fs.copyFileSync(path.join(__dirname, "..", f), path.join(RAIZ, f));
}
fs.writeFileSync(path.join(RAIZ, "carla-app", "js", "config.js"), `global.CARLA_CONFIG = { nomesDiaSemana: ["domingo","segunda","terça","quarta","quinta","sexta","sábado"] };\n`);
fs.writeFileSync(path.join(RAIZ, "carla-app", "js", "agenda.js"), `
function toDateStr(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }
module.exports = { gerarSlotsPossiveis: () => [], formatHora: (h) => h, toDateStr };
`);

// ---- o banco como a política antiga o deixou -------------------------------------------
const ARQ = path.join(RAIZ, "data", "agendamentos.sqlite");
const VENCIDO_EM = "2026-09-10T12:00:00.000Z";  // prazo já passado
const payload = (extra) => JSON.stringify({
  slotId: "reserva-velha", data: "2099-09-10", horario: "14:00", diaLabel: "10/09 às 14:00",
  responsavel: "Ana", crianca: "Miguel", telefone: "+5519999990001", estado: "reservado",
  pago: false, modalidade: "presencial", tipoConsulta: "puericultura",
  registradoEm: "2026-09-01T10:00:00.000Z", ...extra,
});
{
  const db = new DatabaseSync(ARQ);
  db.exec(`
    CREATE TABLE agenda_meta (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
    CREATE TABLE agendamentos (
      slot_id TEXT PRIMARY KEY, horario_real TEXT NOT NULL,
      estado TEXT NOT NULL CHECK (estado IN ('reservado','pago','vencido','cancelado')),
      expires_at TEXT, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX agendamentos_horario_ativo ON agendamentos(horario_real) WHERE estado IN ('reservado','pago');
  `);
  // A importação do JSON já tinha acontecido lá atrás, como na VPS.
  db.prepare("INSERT INTO agenda_meta (chave, valor) VALUES (?, ?)").run("json_importado_v1", "2026-08-01T00:00:00.000Z");
  db.prepare("INSERT INTO agendamentos (slot_id, horario_real, estado, expires_at, payload_json, updated_at) VALUES (?,?,?,?,?,?)")
    .run("reserva-velha", "2099-09-10T14:00", "reservado", VENCIDO_EM, payload({ expiresAt: VENCIDO_EM }), "2026-09-01T10:00:00.000Z");
  // Uma paga e uma já vencida, pra conferir que a migração não encosta nelas.
  db.prepare("INSERT INTO agendamentos (slot_id, horario_real, estado, expires_at, payload_json, updated_at) VALUES (?,?,?,?,?,?)")
    .run("reserva-paga", "2099-09-11T14:00", "pago", VENCIDO_EM, payload({ slotId: "reserva-paga", data: "2099-09-11", estado: "pago", pago: true, expiresAt: VENCIDO_EM }), "2026-09-01T10:00:00.000Z");
  db.prepare("INSERT INTO agendamentos (slot_id, horario_real, estado, expires_at, payload_json, updated_at) VALUES (?,?,?,?,?,?)")
    .run("reserva-morta", "2099-09-12T14:00", "vencido", VENCIDO_EM, payload({ slotId: "reserva-morta", data: "2099-09-12", estado: "vencido", expiresAt: VENCIDO_EM }), "2026-09-01T10:00:00.000Z");
  db.close();
}

const Storage = require(path.join(RAIZ, "storage-node.js"));

// ------------------------------------------------- 1. a reserva antiga sobrevive ao relógio
{
  const bemDepois = new Date("2030-01-01T00:00:00.000Z");
  const viva = Storage.lerAgendamentos(bemDepois).find((a) => a.slotId === "reserva-velha");
  ok(!!viva, "1. anos depois do prazo antigo, a reserva continua ativa (antes ela virava 'vencida' sozinha)");
  if (viva) {
    eq(viva.estado, "reservado", "1b. e continua reservada");
    eq(viva.expiresAt, null, "1c. sem prazo nenhum: é isso que impede o vencimento de voltar");
    eq(viva.pago, false, "1d. e não foi marcada como paga de brinde: quem marca é o Dr. Bruno");
  }
}

// ------------------------------------------------- 2. o banco por dentro
{
  const db = new DatabaseSync(ARQ);
  const linha = db.prepare("SELECT expires_at, payload_json FROM agendamentos WHERE slot_id = ?").get("reserva-velha");
  eq(linha.expires_at, null, "2. a coluna do prazo foi apagada");
  eq(JSON.parse(linha.payload_json).expiresAt, null, "2b. e o prazo dentro do payload também, que é de onde o painel e o bot leem");
  const marca = db.prepare("SELECT valor FROM agenda_meta WHERE chave = ?").get("prazo_antigo_removido_v1");
  ok(!!marca, "2c. a migração fica marcada, pra não rodar de novo a cada boot");
  ok(/\(1\)$/.test(marca.valor), "2d. guardando quantas foram, pra dar pra conferir depois");

  // As outras não foram tocadas: cancelada e vencida são história, e reescrever o passado
  // esconderia justamente o que esta mudança veio corrigir.
  eq(db.prepare("SELECT expires_at FROM agendamentos WHERE slot_id = ?").get("reserva-morta").expires_at, VENCIDO_EM, "2e. a que já estava vencida continua como estava");
  db.close();
}

// ------------------------------------------------- 3. roda uma vez só
{
  // Simula um boot seguinte com uma reserva que (por qualquer motivo) tenha prazo: a
  // migração já rodou e não mexe mais em nada, então a marca continua dizendo 1.
  const db = new DatabaseSync(ARQ);
  db.prepare("INSERT INTO agendamentos (slot_id, horario_real, estado, expires_at, payload_json, updated_at) VALUES (?,?,?,?,?,?)")
    .run("reserva-nova", "2099-09-13T14:00", "reservado", "2099-09-13T13:00:00.000Z", payload({ slotId: "reserva-nova", data: "2099-09-13", expiresAt: "2099-09-13T13:00:00.000Z" }), "2026-09-11T10:00:00.000Z");
  db.close();
  delete require.cache[path.join(RAIZ, "storage-node.js")];
  const Storage2 = require(path.join(RAIZ, "storage-node.js"));
  const nova = Storage2.lerAgendamentos(new Date("2026-09-11T12:00:00.000Z")).find((a) => a.slotId === "reserva-nova");
  eq(nova && nova.expiresAt, "2099-09-13T13:00:00.000Z", "3. a migração não roda de novo: um prazo gravado depois dela continua lá");
  const db2 = new DatabaseSync(ARQ);
  eq(db2.prepare("SELECT COUNT(*) AS n FROM agenda_meta WHERE chave = ?").get("prazo_antigo_removido_v1").n, 1, "3b. e a marca continua sendo uma só");
  db2.close();
}

// ------------------------------------------------- 4. o código que garante isso
{
  const fonte = fs.readFileSync(path.join(__dirname, "..", "storage-node.js"), "utf8");
  const mig = fonte.slice(fonte.indexOf("function soltarPrazosDaPoliticaAntiga("), fonte.indexOf("function vencerReservasNoBanco("));
  ok(/estado = 'reservado' AND expires_at IS NOT NULL/.test(mig), "4. só mexe em reserva ativa com prazo");
  ok(/prazo_antigo_removido_v1/.test(mig) && /if \(feita\) return 0;/.test(mig), "4b. e uma vez só");
  ok(/emTransacao\(db, \(\) => \{/.test(mig), "4c. tudo numa transação: ou apaga os prazos e marca, ou não faz nada");
  ok(/migrarAgendamentosDoJSON\(db\);\s*\n\s*soltarPrazosDaPoliticaAntiga\(db\);\s*\n\s*vencerReservasNoBanco\(db, new Date\(\), false\);\s*\n\s*exportarAgendaLegada\(db\);\s*\n\s*return db;/.test(fonte), "4d. roda ao abrir o banco, na ordem certa, antes de qualquer leitura");
  const abre = fonte.slice(fonte.indexOf("function iniciarBancoAgendamentos("), fonte.indexOf("function emTransacao("));
  ok(abre.indexOf("migrarAgendamentosDoJSON(db)") < abre.indexOf("soltarPrazosDaPoliticaAntiga(db)"), "4e. depois da importação do JSON: o que veio de lá também perde o prazo");
  ok(abre.indexOf("soltarPrazosDaPoliticaAntiga(db)") < abre.indexOf("vencerReservasNoBanco(db, new Date(), false)"), "4f. e ANTES do vencimento: com o vencimento na frente, a primeira subida já vencia as antigas e a migração chegava tarde (foi o que aconteceu na primeira tentativa desta correção)");
  ok(!/vencerReservasNoBanco\(db, new Date\(\), false\);/.test(fonte.slice(fonte.indexOf("function migrarAgendamentosDoJSON("), fonte.indexOf("function soltarPrazosDaPoliticaAntiga("))), "4g. o vencimento saiu de dentro da importação do JSON, que é onde ele passava na frente");
}

fs.rmSync(TEMP, { recursive: true, force: true });
console.log(`\nprazo-antigo-some: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
