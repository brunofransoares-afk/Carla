/*
 * Bateria: a aba Agenda abre nos agendamentos que ainda vão acontecer.
 *
 * O dono, em 01/10/2026: "ali nos agendamentos fica marcando na tela os agendamentos que ja
 * foram tbm, os passados, tem que mostrar ali somente os futuros. e ai uma abinha caso eu
 * queira ver o historico ai mostra todos. mas na tela inicial so os futuros".
 *
 * O que se guarda aqui, além do filtro:
 *   - "Futuro" é a consulta que ainda não ACABOU. A das 10h continua na lista às 10h30, que
 *     é quando ele está atendendo e pode precisar da ficha.
 *   - O contador da aba conta os próximos. Um número que cresce pra sempre com o passado
 *     deixa de dizer alguma coisa.
 *   - O histórico mostra TODOS, o mais recente em cima.
 *
 * Roda com:  node tests/agenda-so-futuros.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const TELA = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");

// A função de verdade, tirada da tela e executada.
const inicio = TELA.indexOf("function agendamentoJaAcabou(");
const fim = TELA.indexOf("\n  }\n", inicio) + 4;
const acabou = new Function(TELA.slice(inicio, fim) + "\nreturn agendamentoJaAcabou;")();

// ------------------------------------------------- 1. o que é "já acabou"
{
  const agora = new Date(2026, 9, 1, 10, 30);
  ok(!acabou({ data: "2026-10-01", horario: "10:00" }, agora),
    "1. a das 10h às 10h30 ainda está acontecendo: continua nos próximos");
  ok(acabou({ data: "2026-10-01", horario: "09:00" }, agora), "1b. a das 9h já acabou às 10h30");
  ok(!acabou({ data: "2026-10-02", horario: "08:00" }, agora), "1c. a de amanhã é futura");
  ok(acabou({ data: "2026-09-30", horario: "16:30" }, agora), "1d. a de ontem acabou");
  ok(!acabou({ data: "2026-10-01" }, agora), "1e. sem horário, vale o dia inteiro: não some no meio do dia");
  ok(acabou({ data: "2026-09-30" }, agora), "1f. e some no dia seguinte");
  ok(!acabou({}, agora), "1g. sem data, não some: na dúvida, mostrar");
  ok(!acabou(null, agora), "1h. e lixo não derruba a tela");
}

// ------------------------------------------------- 2. a tela
{
  ok(/data-filtro="proximos" aria-pressed="true">Próximos</.test(TELA), "2. a aba abre em Próximos");
  ok(/data-filtro="historico" aria-pressed="false">Histórico</.test(TELA), "2b. com o Histórico ao lado");
  ok(/let filtroAgendamentos = "proximos";/.test(TELA), "2c. e começa sempre nos próximos");
  ok(/const proximos = todosAgendamentos\.filter\(\(a\) => !agendamentoJaAcabou\(a\)\);/.test(TELA),
    "2d. a lista de abertura é filtrada pela função testada acima");
  ok(/filtroAgendamentos === "historico" \? todosAgendamentos\.slice\(\)\.reverse\(\) : proximos/.test(TELA),
    "2e. e o histórico mostra todos, o mais recente em cima");
  ok(/getElementById\("contagem-agendamentos"\)\.textContent = proximos\.length;/.test(TELA),
    "2f. o contador da aba conta os próximos, não o total");
  ok(/renderizarProximas\(proximos\);/.test(TELA),
    "2g. e o bloco de próximas da visão geral também recebe só os futuros, mesmo com o histórico aberto");
}

console.log(`agenda-so-futuros: ${passou} passaram, ${erros.length} falharam`);
if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
