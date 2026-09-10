/*
 * Bateria do horário extra só de teleconsulta.
 *
 * O Dr. Bruno já abre horários extras pelo painel. Alguns ele quer reservar só pra
 * atendimento por vídeo: dá pra encaixar entre coisas em que uma consulta presencial não cabe.
 * A teleconsulta pode usar qualquer horário normal E esses exclusivos; a presencial usa só os
 * normais.
 *
 * O PADRÃO SEGURO É ESCONDER. Sem a família dizer "por vídeo", a Carla não passa modalidade,
 * e o horário exclusivo nem aparece na roda. Se por qualquer caminho ela tentar reservar um
 * horário de vídeo como presencial, a ferramenta recusa: uma família apareceria no consultório
 * num horário em que o Dr. Bruno não pode receber ninguém.
 *
 * A MARCA VIAJA NO SLOT INTEIRO: label que a Carla lê, lista do painel, regra de oferta e
 * payload da reserva (pro painel e pro título do evento na agenda). O id do extra NÃO muda com
 * a marca: é a mesma vaga, só com restrição, e liberar de novo com a marca diferente atualiza.
 *
 * Roda com:  node tests/horario-so-teleconsulta.test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

// Storage isolado: grava em ./data ao lado de si mesmo, então sem cópia sujaria dado real.
const RAIZ = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "carla-tele-")), "bot");
fs.mkdirSync(path.join(RAIZ, "data"), { recursive: true });
for (const f of ["storage-node.js", "arquivo-atomico.js", "grade-teleconsulta.js"]) fs.copyFileSync(path.join(__dirname, "..", f), path.join(RAIZ, f));
const IRMA = path.join(RAIZ, "carla-app", "js");
fs.mkdirSync(IRMA, { recursive: true });
fs.writeFileSync(path.join(IRMA, "config.js"), 'global.CARLA_CONFIG = { nomesDiaSemana: ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"] };\n');
fs.writeFileSync(path.join(IRMA, "agenda.js"), "module.exports = { gerarSlotsPossiveis: () => [], formatHora: (h) => h };\n");
const Storage = require(path.join(RAIZ, "storage-node.js"));

const LER = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const CEREBRO = LER("cerebro-ia.js"), SERVER = LER("server.js"), PAINEL = LER("painel-server.js"), TELA = LER("dashboard.html");
const PROMPT = CEREBRO.slice(CEREBRO.indexOf("const PROMPT_ESTAVEL = `"), CEREBRO.indexOf("function montarSystemPrompt("));
const SEM_COMENTARIO = PROMPT.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

const AGORA = new Date("2026-09-10T08:00:00");   // quinta; os extras ficam no futuro
const DIA = "2026-09-14";                           // segunda

// ------------------------------------------------- 1. a marca entra e sai do armazenamento
{
  Storage.adicionarHorarioExtra(DIA, "13:00", { soTeleconsulta: true });
  Storage.adicionarHorarioExtra(DIA, "13:30");
  const extras = Storage.listarSlotsExtras(AGORA);
  const tele = extras.find((s) => s.time === "13:00");
  const comum = extras.find((s) => s.time === "13:30");
  ok(tele && tele.soTeleconsulta === true, "1. o extra liberado com a marca sai marcado");
  ok(comum && comum.soTeleconsulta === false, "1b. o extra liberado sem a marca sai sem ela (compatível com os antigos)");
  eq(tele.id, "extra-2026-09-14-13:00", "1c. o id NÃO muda com a marca: é a mesma vaga, só com restrição");
  ok(/\(só teleconsulta\)$/.test(tele.label), "1d. o label que a Carla lê diz que é só vídeo");
  ok(!/teleconsulta/.test(comum.label), "1e. e o comum não ganha sufixo nenhum");
}

// ------------------------------------------------- 2. liberar de novo ATUALIZA a marca
{
  Storage.adicionarHorarioExtra(DIA, "13:30", { soTeleconsulta: true });
  eq(Storage.listarSlotsExtras(AGORA).filter((s) => s.time === "13:30").length, 1, "2. não duplica a vaga");
  eq(Storage.listarSlotsExtras(AGORA).find((s) => s.time === "13:30").soTeleconsulta, true, "2b. só muda a marca (clique errado tem conserto)");
  Storage.adicionarHorarioExtra(DIA, "13:30", { soTeleconsulta: false });
  eq(Storage.listarSlotsExtras(AGORA).find((s) => s.time === "13:30").soTeleconsulta, false, "2c. e volta, nos dois sentidos");
}

// ------------------------------------------------- 3. a oferta esconde por padrão
{
  const sem = Storage.extrasDisponiveis(AGORA, new Set(), {});
  ok(!sem.some((s) => s.time === "13:00"), "3. sem modalidade, o horário de vídeo NÃO entra na roda");
  ok(sem.some((s) => s.time === "13:30"), "3b. mas o extra comum entra");
  const presencial = Storage.extrasDisponiveis(AGORA, new Set(), { modalidade: "presencial" });
  ok(!presencial.some((s) => s.time === "13:00"), "3c. 'presencial' explícito idem");
  const tele = Storage.extrasDisponiveis(AGORA, new Set(), { modalidade: "teleconsulta" });
  ok(tele.some((s) => s.time === "13:00") && tele.some((s) => s.time === "13:30"),
    "3d. com 'teleconsulta', aparecem os exclusivos E os comuns: vídeo pode usar qualquer um");
}

// ------------------------------------------------- 4. o painel enxerga a marca
{
  const dia = Storage.listarHorariosDoDia(DIA, AGORA);
  const h = dia.horarios.find((x) => x.time === "13:00");
  ok(h && h.soTeleconsulta === true && h.extra === true, "4. listarHorariosDoDia leva soTeleconsulta pro painel");
  ok(h.modalidade === null, "4b. livre, sem modalidade de reserva");
}

// ------------------------------------------------- 5. a reserva guarda a modalidade
{
  const slot = Storage.listarSlotsExtras(AGORA).find((s) => s.time === "13:00");
  const ok1 = Storage.reservar({ slot, responsavel: "Ana", crianca: "Miguel", telefone: "+5519000001", modalidade: "teleconsulta" });
  ok(ok1 && ok1.modalidade === "teleconsulta", "5. a reserva sai com modalidade");
  eq(Storage.listarHorariosDoDia(DIA, AGORA).horarios.find((x) => x.time === "13:00").modalidade, "teleconsulta",
    "5b. e o painel vê a modalidade da consulta marcada");
  const slot2 = Storage.listarSlotsExtras(AGORA).find((s) => s.time === "13:30");
  const ok2 = Storage.reservar({ slot: slot2, responsavel: "Ana", crianca: "Lis", telefone: "+5519000002" });
  eq(ok2 && ok2.modalidade, "presencial", "5c. sem dizer, é presencial: nunca fica indefinido");
  const ok3 = Storage.reservar({ slot: { ...slot2, id: "x-1", date: DIA, time: "14:00" }, responsavel: "A", crianca: "B", telefone: "+551900003", modalidade: "qualquer coisa" });
  eq(ok3 && ok3.modalidade, "presencial", "5d. lixo no campo cai em presencial, não vaza");
}

// ------------------------------------------------- 6. a ferramenta recusa vídeo pra presencial
{
  ok(/if \(slotReal\.soTeleconsulta && modalidade !== "teleconsulta"\) \{/.test(CEREBRO),
    "6. confirmar_agendamento recusa horário de vídeo pra consulta presencial");
  ok(/é aberto SÓ pra teleconsulta e esta consulta é presencial/.test(CEREBRO), "6b. dizendo o porquê pra Carla");
  ok(/const modalidade = input\.modalidade === "teleconsulta" \? "teleconsulta" : "presencial";/.test(CEREBRO),
    "6c. e qualquer outra coisa é presencial, o lado seguro");
  ok(/Storage\.reservar\(\{[\s\S]{0,120}modalidade,/.test(CEREBRO), "6d. a modalidade vai pra reserva");
  ok(/\$\{rotuloTipo\}\$\{modalidade === "teleconsulta" \? " \(vídeo\)" : ""\} - \$\{crianca\}/.test(CEREBRO),
    "6e. e pro título do evento na agenda, pra ele saber que é vídeo sem abrir");
  ok(/\$\{agendamento\.modalidade === "teleconsulta" \? "Teleconsulta" : "Consulta"\} - \$\{agendamento\.crianca\}/.test(SERVER),
    "6f. inclusive na sincronização durável do server");
}

// ------------------------------------------------- 7. a busca só mostra vídeo quando a família pediu
{
  ok(/modalidade: \{ type: \["string", "null"\], enum: \["teleconsulta", "presencial", null\]/.test(CEREBRO),
    "7. consultar_horarios e confirmar_agendamento têm o parâmetro modalidade");
  eq((CEREBRO.match(/enum: \["teleconsulta", "presencial", null\]/g) || []).length, 2, "7b. nas DUAS ferramentas");
  ok(/const filtros = \{ diaPreferido, periodo, dataPreferida, modalidade \};/.test(CEREBRO), "7c. a busca normal filtra por modalidade");
  ok(/extrasDisponiveis\(ctx\.now, ctx\.idsOcupados, \{ modalidade: input\.modalidade === "teleconsulta" \? "teleconsulta" : null \}\)/.test(CEREBRO),
    "7d. e a busca urgente também, senão o caminho do 'pra hoje' vazaria horário de vídeo");
  ok(/const modalidade = input\.modalidade === "teleconsulta" \? "teleconsulta" : null;/.test(CEREBRO),
    "7e. na busca, tudo que não é 'teleconsulta' vira null (presencial)");
}

// ------------------------------------------------- 8. o painel e a tela
{
  ok(/Storage\.adicionarHorarioExtra\(data, hora, \{ soTeleconsulta: corpo\.soTeleconsulta === true \}\)/.test(PAINEL),
    "8. a rota aceita a marca, e só true de verdade liga (string 'false' não liga)");
  ok(/id="input-extra-tele"/.test(TELA), "8b. a tela tem a caixinha 'só teleconsulta'");
  ok(/soTeleconsulta = !!document\.getElementById\("input-extra-tele"\)\.checked/.test(TELA), "8c. e manda o estado dela");
  ok(/class="chip-extra\$\{h\.soTeleconsulta \? " so-tele" : ""\}"/.test(TELA), "8d. o chip do extra mostra que é vídeo");
  ok(/if \(h\.soTeleconsulta\) classes\.push\("so-tele"\);/.test(TELA), "8e. e o botão do horário na grade também");
  ok(/\(extra, só teleconsulta\)/.test(TELA), "8f. com o título dizendo isso ao passar o mouse");
}

// ------------------------------------------------- 9. o prompt: pelas ferramentas, não pela cabeça
{
  ok(/HORÁRIOS SÓ DE TELECONSULTA:/.test(SEM_COMENTARIO), "9. a regra existe");
  ok(/passe modalidade="teleconsulta" em consultar_horarios \(só assim os exclusivos aparecem\) e em confirmar_agendamento/.test(SEM_COMENTARIO),
    "9b. diz pra passar a modalidade nas DUAS ferramentas");
  ok(/Quando não disser nada, não passe modalidade \(vale presencial\) e os exclusivos nem aparecem/.test(SEM_COMENTARIO),
    "9c. e o padrão é esconder");
  ok(/nunca é oferecido pra quem vai ao consultório, e a ferramenta recusa se você tentar/.test(SEM_COMENTARIO),
    "9d. avisando que a ferramenta recusa, pra ela não insistir");
  ok(/Você não anuncia que existem horários "extras de vídeo" nem oferece teleconsulta por conta própria/.test(SEM_COMENTARIO),
    "9e. e a regra antiga de só falar de tele quando perguntarem continua de pé, escrita ao lado");
  ok(/Só fale sobre teleconsulta \(e a ressalva/.test(SEM_COMENTARIO), "9f. (a regra antiga, intacta)");
}

console.log(`\nhorario-so-teleconsulta: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
