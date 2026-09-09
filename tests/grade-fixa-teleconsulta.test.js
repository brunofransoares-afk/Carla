/*
 * Bateria da grade fixa de teleconsulta.
 *
 * Terça 20h, quarta 20h, sexta 18h/19h/20h: horários que existem toda semana, só pra vídeo.
 * Em vez de o Dr. Bruno liberar cinco horários toda semana na mão, a regra gera os extras
 * sozinha e eles entram na roda EXATAMENTE como um extra marcado "só teleconsulta".
 *
 * E a conversa muda: quando a família quer teleconsulta, a Carla pergunta ANTES de buscar
 * se prefere horário comercial (durante o dia) ou à noite, e busca com esse período. É a
 * única situação em que ela pergunta período antes de consultar, e a regra AGENDAMENTO sabe.
 *
 * Roda com:  node tests/grade-fixa-teleconsulta.test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const RAIZ_REPO = path.join(__dirname, "..");
const Grade = require(path.join(RAIZ_REPO, "grade-teleconsulta.js"));
const Ordem = require(path.join(RAIZ_REPO, "ordem-dos-horarios.js"));

const RAIZ = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "carla-grade-")), "bot");
fs.mkdirSync(path.join(RAIZ, "data"), { recursive: true });
for (const f of ["storage-node.js", "arquivo-atomico.js", "grade-teleconsulta.js"]) fs.copyFileSync(path.join(RAIZ_REPO, f), path.join(RAIZ, f));
const IRMA = path.join(RAIZ, "carla-app", "js");
fs.mkdirSync(IRMA, { recursive: true });
fs.writeFileSync(path.join(IRMA, "config.js"), 'global.CARLA_CONFIG = { nomesDiaSemana: ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"] };\n');
fs.writeFileSync(path.join(IRMA, "agenda.js"), "module.exports = { gerarSlotsPossiveis: () => [], formatHora: (h) => h };\n");
const Storage = require(path.join(RAIZ, "storage-node.js"));

const LER = (f) => fs.readFileSync(path.join(RAIZ_REPO, f), "utf8");
const CEREBRO = LER("cerebro-ia.js"), TELA = LER("dashboard.html");
const PROMPT = CEREBRO.slice(CEREBRO.indexOf("const PROMPT_ESTAVEL = `"), CEREBRO.indexOf("function montarSystemPrompt("));
const SEM_COMENTARIO = PROMPT.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

const QUARTA_10H = new Date(2026, 8, 9, 10, 0); // quarta-feira 09/09/2026 às 10h

// ------------------------------------------------- 1. a grade, com os dias do Dr. Bruno
{
  const dias = Grade.GRADE_FIXA.map((g) => `${g.diaSemana}@${g.hora}`).sort().join(",");
  eq(dias, "2@20:00,3@20:00,5@18:00,5@19:00,5@20:00", "1. terça 20h, quarta 20h, sexta 18h, 19h e 20h");
  const s = Grade.gerarExtrasFixos(QUARTA_10H);
  eq(s[0].data + " " + s[0].hora, "2026-09-09 20:00", "1b. hoje é quarta de manhã: a de hoje à noite ainda entra");
  eq(s.slice(1, 4).map((x) => x.data + " " + x.hora).join(" | "), "2026-09-11 18:00 | 2026-09-11 19:00 | 2026-09-11 20:00", "1c. sexta traz as três");
  eq(s[4].data + " " + s[4].hora, "2026-09-15 20:00", "1d. depois a terça seguinte");
  ok(s.every((x) => x.soTeleconsulta === true && x.fixo === true), "1e. tudo marcado só-vídeo e fixo");
  eq(s.length, 5 * Grade.SEMANAS_DE_HORIZONTE, "1f. cinco por semana dentro do horizonte");
}

// ------------------------------------------------- 2. só o futuro, e o horizonte fecha
{
  const s = Grade.gerarExtrasFixos(new Date(2026, 8, 9, 20, 30)); // quarta 20h30: a das 20h já passou
  ok(s[0].data !== "2026-09-09", "2. horário de hoje que já passou não entra");
  const ultimo = s[s.length - 1];
  const limite = new Date(2026, 8, 9); limite.setDate(limite.getDate() + Grade.SEMANAS_DE_HORIZONTE * 7);
  ok(new Date(ultimo.data) < limite, "2b. nada além do horizonte");
  eq(Grade.periodoDaHora("18:00"), "noite", "2c. 18h já é noite");
  eq(Grade.periodoDaHora("17:59"), "comercial", "2d. 17h59 ainda é comercial");
}

// ------------------------------------------------- 3. entra na roda como extra de vídeo
{
  const extras = Storage.listarSlotsExtras(QUARTA_10H);
  const hoje20 = extras.find((s) => s.date === "2026-09-09" && s.time === "20:00");
  ok(hoje20 && hoje20.soTeleconsulta && hoje20.fixo && hoje20.extra, "3. o fixo sai como extra só-vídeo, marcado fixo");
  // (hoje20 || {}): sem a quarta na grade este slot não existe, e o teste tem que FALHAR,
  // não estourar no meio e derrubar o run-all.
  eq((hoje20 || {}).id, "extra-2026-09-09-20:00", "3b. com id de extra comum: reserva e bloqueio funcionam igual");
  ok(/\(só teleconsulta\)$/.test((hoje20 || {}).label || ""), "3c. e o label que a Carla lê diz que é vídeo");
}

// ------------------------------------------------- 4. o liberado na mão VENCE o fixo
{
  Storage.adicionarHorarioExtra("2026-09-11", "18:00", { soTeleconsulta: false });
  const s = Storage.listarSlotsExtras(QUARTA_10H).filter((x) => x.date === "2026-09-11" && x.time === "18:00");
  eq(s.length, 1, "4. não duplica o horário");
  ok(s[0].fixo === false && s[0].soTeleconsulta === false, "4b. vale o que o Dr. Bruno decidiu no painel (aqui: liberou pra tudo)");
  Storage.removerHorarioExtra("extra-2026-09-11-18:00");
  const volta = Storage.listarSlotsExtras(QUARTA_10H).find((x) => x.date === "2026-09-11" && x.time === "18:00");
  ok(volta && volta.fixo === true, "4c. removeu o manual, o fixo volta a valer sozinho");
}

// ------------------------------------------------- 5. fixo não se remove, se bloqueia
{
  Storage.removerHorarioExtra("extra-2026-09-09-20:00");
  ok(Storage.listarSlotsExtras(QUARTA_10H).some((x) => x.id === "extra-2026-09-09-20:00"), "5. remover um fixo pelo painel não faz nada: ele é regra");
  Storage.alternarBloqueioHorario("extra-2026-09-09-20:00");
  ok(Storage.idsOcupados(QUARTA_10H).has("extra-2026-09-09-20:00"), "5b. mas bloquear o horário tira ele de circulação, como qualquer outro");
  Storage.alternarBloqueioHorario("extra-2026-09-09-20:00");
  eq((Storage.listarHorariosDoDia("2026-09-09", QUARTA_10H).horarios.find((h) => h.time === "20:00") || {}).fixo, true, "5c. e o painel sabe que é fixo");
}

// ------------------------------------------------- 6. comercial x noite, e só pra vídeo
{
  const noite = Storage.extrasDisponiveis(QUARTA_10H, new Set(), { modalidade: "teleconsulta", periodo: "noite" });
  ok(noite.length > 0 && noite.every((s) => s.time >= "18:00"), "6. 'noite' com teleconsulta traz só os da noite");
  const comercial = Storage.extrasDisponiveis(QUARTA_10H, new Set(), { modalidade: "teleconsulta", periodo: "comercial" });
  ok(!comercial.some((s) => s.fixo), "6b. 'comercial' não traz nenhum fixo (todos são noite)");
  // Um extra de vídeo liberado NA MÃO, de dia. É o que prova que o filtro de período existe:
  // os fixos são todos de noite, então sem este caso tirar o filtro não mudaria nada.
  Storage.adicionarHorarioExtra("2026-09-15", "14:00", { soTeleconsulta: true });
  const noiteComDia = Storage.extrasDisponiveis(QUARTA_10H, new Set(), { modalidade: "teleconsulta", periodo: "noite" });
  ok(!noiteComDia.some((s) => s.date === "2026-09-15" && s.time === "14:00"), "6e. 'noite' NÃO traz um extra de vídeo das 14h");
  const comercialComDia = Storage.extrasDisponiveis(QUARTA_10H, new Set(), { modalidade: "teleconsulta", periodo: "comercial" });
  ok(comercialComDia.some((s) => s.date === "2026-09-15" && s.time === "14:00"), "6f. e 'comercial' traz ele");
  Storage.removerHorarioExtra("extra-2026-09-15-14:00");
  const presencial = Storage.extrasDisponiveis(QUARTA_10H, new Set(), { periodo: "noite" });
  eq(presencial.length, 0, "6c. sem modalidade de vídeo, a grade fixa some inteira: presencial nunca vê");
  const quarta = Storage.extrasDisponiveis(QUARTA_10H, new Set(), { modalidade: "teleconsulta", diaPreferido: 3 });
  ok(quarta.length > 0 && quarta.every((s) => new Date(s.date + "T12:00:00").getDay() === 3), "6d. dá pra pedir quarta, que só existe pra vídeo");
}

// ------------------------------------------------- 7. bate() entende o corte
{
  const g = (time) => ({ id: "g", date: "2026-09-15", time, weekday: 2 });
  ok(Ordem.bate(g("20:00"), { periodo: "noite" }) && !Ordem.bate(g("14:00"), { periodo: "noite" }), "7. noite: das 18h em diante");
  ok(Ordem.bate(g("14:00"), { periodo: "comercial" }) && !Ordem.bate(g("18:00"), { periodo: "comercial" }), "7b. comercial: antes das 18h");
  ok(Ordem.bate(g("14:00"), { periodo: "tarde" }) && !Ordem.bate(g("14:00"), { periodo: "manha" }), "7c. manhã e tarde continuam como eram");
}

// ------------------------------------------------- 8. a ferramenta conhece quarta e os períodos novos
{
  ok(/quarta: 3,/.test(CEREBRO), "8. 'quarta' existe no mapa de dias");
  ok(/enum: \["segunda", "terca", "quarta", "quinta", "sexta", null\]/.test(CEREBRO), "8b. e no enum da ferramenta");
  ok(/enum: \["manha", "tarde", "comercial", "noite", null\]/.test(CEREBRO), "8c. período ganhou comercial e noite");
  ok(/\["manha", "tarde", "comercial", "noite"\]\.includes\(input\.periodo\)/.test(CEREBRO), "8d. e a validação aceita os quatro");
  ok(/const periodoDaAgenda = periodo === "manha" \|\| periodo === "tarde" \? periodo : null;/.test(CEREBRO),
    "8e. pra agenda.js vai só manhã/tarde, que é o que ela entende");
  ok(/Agenda\.oferecerSlots\(ctx\.now, ctx\.idsOcupados, \{ \.\.\.filtros, periodo: periodoDaAgenda, count: 6 \}\)/.test(CEREBRO),
    "8f. e é isso que a busca da grade recebe");
}

// ------------------------------------------------- 9. a Carla pergunta antes, e só aqui
{
  ok(/terça às 20h, quarta às 20h e sexta às 18h, 19h e 20h/.test(SEM_COMENTARIO), "9. a grade está escrita no prompt");
  ok(/ANTES DE BUSCAR HORÁRIO você faz UMA pergunta, numa mensagem sozinha: se prefere em horário comercial, durante o dia, ou à noite/.test(SEM_COMENTARIO),
    "9b. pergunta comercial ou noite antes de buscar");
  ok(/É a única situação em que você pergunta período antes de consultar \(a regra AGENDAMENTO sabe disso\)/.test(SEM_COMENTARIO),
    "9c. e diz que é a única exceção, apontando pra regra que ela contraria");
  ok(/A ÚNICA exceção é teleconsulta, que tem uma pergunta própria antes/.test(SEM_COMENTARIO),
    "9d. a regra AGENDAMENTO, do lado dela, reconhece a exceção: as duas conversam");
  ok(/periodo="comercial" ou periodo="noite"/.test(SEM_COMENTARIO), "9e. e busca com o período respondido");
  ok(/Nunca liste a grade de vídeo inteira de cabeça/.test(SEM_COMENTARIO), "9f. sem recitar a grade: oferece o que a ferramenta devolver");
  ok(/dia sem atendimento PRESENCIAL nenhum/.test(SEM_COMENTARIO) && /à noite tem teleconsulta/.test(SEM_COMENTARIO),
    "9g. a regra da quarta foi escopada: sem presencial, mas com vídeo à noite");
}

// ------------------------------------------------- 10. o painel não deixa apagar o fixo
{
  ok(/h\.extra && !h\.ocupado && !h\.fixo/.test(TELA), "10. o ✕ de remover não aparece no fixo");
  ok(/\(grade fixa de teleconsulta\)/.test(TELA), "10b. e o título do horário diz que é da grade fixa");
}

console.log(`\ngrade-fixa-teleconsulta: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
