/*
 * Bateria: a agenda contínua.
 *
 * O dono, em 01/10/2026: "ela marcou um paciente numa quinta feira as 8h, pros outros
 * pacientes que mandarem conversa, ela deve tentar oferecer o horario das 10h com
 * prioridade... nao eh pra forcar a familia... tentando agendar as consultas de puericultura
 * e atendimento de transtornos, sempre pra uns 2-3 dias de intervalo do dia atual.. ou na
 * proxima semana... ja quando a familia seleciona a consulta de urgencia, pode oferecer a
 * consulta logo no dia seguinte se houver horario".
 *
 * ESTA LÓGICA JÁ EXISTIA EM PARTE, E NÃO FUNCIONAVA. Agenda.oferecerSlots punha primeiro os
 * dias que já tinham consulta, e logo depois ordenarCandidatos reordenava tudo por horário e
 * desfazia isso. Nenhum teste olhava o resultado das duas etapas juntas. Por isso o bloco 4
 * abaixo confere o caminho inteiro, como cerebro-ia.js o chama, e não só a função nova.
 *
 * Roda com:  node tests/agenda-continua.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
require(path.join(__dirname, "..", "carla-app", "js", "config.js"));
const Agenda = require(path.join(__dirname, "..", "carla-app", "js", "agenda.js"));
const Ordem = require(path.join(__dirname, "..", "ordem-dos-horarios.js"));

let passou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

// Segunda-feira 05/10/2026, 9h. A grade: quinta 08/10 tem 8h, 10h, 14h30 e 16h30 (2ª quinta).
const AGORA = new Date(2026, 9, 5, 9, 0);
const FOLGA = global.CARLA_CONFIG.diasDeFolgaRotina;
const ordenar = (ocupados) => Ordem.ordenarCandidatos(
  Agenda.disponiveis(AGORA, ocupados), [],
  { continuidade: { ocupados, agora: AGORA, diasDeFolga: FOLGA, horariosDoDia: Agenda.horariosDoDia } });

// ------------------------------------------------- 1. o exemplo dele, literal
{
  const ocupados = new Set(["2026-10-08T08:00"]);
  const ordem = ordenar(ocupados);
  eq(ordem[0].id, "2026-10-08T10:00", "1. quinta 8h marcada: a primeira opção é quinta 10h");
  ok(ordem[1] && ordem[1].date !== ordem[0].date,
    "1b. e a segunda é de OUTRO dia: se quinta não serve, duas opções na quinta são uma só (" + (ordem[1] && ordem[1].label) + ")");
}

// ------------------------------------------------- 2. vizinhança é dos dois lados
{
  const ocupados = new Set(["2026-10-08T14:30"]);
  const ordem = ordenar(ocupados);
  ok(["2026-10-08T10:00", "2026-10-08T16:30"].includes(ordem[0].id),
    "2. com quinta 14h30 marcada, a primeira encosta nela, antes ou depois (" + ordem[0].label + ")");
  // Vizinho é vizinho NA GRADE DAQUELE DIA, não por relógio: entre 10h e 14h30 não existe
  // nada, e mesmo assim os dois são vizinhos. É a definição que junta o dia dele.
  ok(Ordem.ordenarPraAgendaContinua([{ id: "a", date: "2026-10-08", time: "10:00" }],
    { ocupados: new Set(["2026-10-08T14:30"]), agora: AGORA, diasDeFolga: 0, horariosDoDia: Agenda.horariosDoDia })[0].id === "a",
    "2b. 10h e 14h30 são vizinhos na quinta, apesar do buraco: é a grade que diz, não o relógio");
}

// ------------------------------------------------- 3. a folga
{
  eq(FOLGA, 2, "3. a folga da rotina é de 2 dias, como ele pediu");
  const ordem = ordenar(new Set());
  const p2 = (n) => String(n).padStart(2, "0");
  const limite = new Date(AGORA.getFullYear(), AGORA.getMonth(), AGORA.getDate() + FOLGA);
  const limiteStr = `${limite.getFullYear()}-${p2(limite.getMonth() + 1)}-${p2(limite.getDate())}`;
  ok(ordem[0].date >= limiteStr, "3b. com a agenda vazia, a primeira opção respeita a folga (" + ordem[0].label + ")");
  ok(ordem[1].date >= limiteStr, "3c. a segunda também");

  // Não é proibição: o que fica antes da folga continua na lista, no fim.
  const amanha = Agenda.disponiveis(AGORA, new Set()).filter((s) => s.date === "2026-10-06");
  ok(amanha.length > 0, "3d. existe horário amanhã (terça), pra conferir que ele não some");
  ok(amanha.every((s) => ordem.some((o) => o.id === s.id)),
    "3e. e ele continua na lista: 'não é pra forçar a família', é só ordem");
  ok(ordem.findIndex((o) => o.date === "2026-10-06") > ordem.findIndex((o) => o.date >= limiteStr),
    "3f. só que atrás de tudo que respeita a folga");

  // Vizinhança antes da folga NÃO fura a folga: juntar a agenda não pode trazer uma
  // puericultura pra amanhã.
  const ordemComAmanha = ordenar(new Set(["2026-10-06T10:00"]));
  ok(ordemComAmanha[0].date >= limiteStr,
    "3g. consulta marcada amanhã não puxa a rotina pra amanhã: a folga vem antes da vizinhança");
}

// ------------------------------------------------- 4. o caminho inteiro, como o cérebro chama
{
  const CEREBRO = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
  ok(/const continuar = !pediuAlgo;/.test(CEREBRO),
    "4. a continuidade só vale quando a família não pediu nada: pedido de dia é dela");
  ok(/count: continuar \? 60 : 6/.test(CEREBRO),
    "4b. e os candidatos são a agenda inteira, senão o horário encostado da semana que vem nem entra");
  ok(/continuidade: \{\s*ocupados: ctx\.idsOcupados,\s*agora: ctx\.now,/.test(CEREBRO),
    "4c. com as consultas marcadas de verdade e o relógio da conversa");
  ok(/horariosDoDia: Agenda\.horariosDoDia,/.test(CEREBRO),
    "4d. e a grade de verdade, com as exceções de quinta e sexta");

  // O caminho inteiro: oferecerSlots (com o count que o cérebro passa) e depois
  // ordenarCandidatos. Foi a soma das duas etapas que estava quebrada.
  const ocupados = new Set(["2026-10-08T08:00"]);
  const grade = Agenda.oferecerSlots(AGORA, ocupados, { count: 60 });
  const final = Ordem.ordenarCandidatos(grade, [],
    { continuidade: { ocupados, agora: AGORA, diasDeFolga: FOLGA, horariosDoDia: Agenda.horariosDoDia } });
  eq(final[0].id, "2026-10-08T10:00", "4e. pelo caminho inteiro, quinta 10h continua sendo a primeira");
}

// ------------------------------------------------- 5. quem pediu algo, e a urgência, não passam aqui
{
  const ocupados = new Set(["2026-10-08T08:00"]);
  const pedido = Ordem.ordenarCandidatos(Agenda.disponiveis(AGORA, ocupados), [], { periodo: "tarde" });
  ok(pedido[0].time >= "12:00", "5. quem pediu tarde recebe tarde, sem a vizinhança atravessar");
  const CEREBRO = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
  const urgente = CEREBRO.slice(CEREBRO.indexOf("if (input.urgente) {"), CEREBRO.indexOf("const diaPreferido = DIA_NOME_PARA_NUMERO"));
  ok(urgente.length > 0 && !/continuidade/.test(urgente),
    "5b. a urgência não usa a continuidade: pra febre, o mais cedo é o certo");
  ok(/\.sort\(\(a, b\) => \(a\.date \+ a\.time\)\.localeCompare\(b\.date \+ b\.time\)\)/.test(urgente),
    "5c. e continua em ordem de tempo, a partir de amanhã");
}

// ------------------------------------------------- 6. a segunda opção em outro dia
{
  const lista = [
    { id: "a", date: "2026-10-08", time: "10:00" },
    { id: "b", date: "2026-10-08", time: "14:30" },
    { id: "c", date: "2026-10-09", time: "10:00" },
  ];
  eq(Ordem.comAlternativaEmOutroDia(lista).map((s) => s.id).join(","), "a,c,b", "6. a segunda vira a de outro dia");
  eq(Ordem.comAlternativaEmOutroDia(lista.slice(0, 2)).map((s) => s.id).join(","), "a,b",
    "6b. sem outro dia, fica o que tem: melhor duas no mesmo dia do que uma só");
  eq(Ordem.comAlternativaEmOutroDia([]).length, 0, "6c. lista vazia não derruba");
}

console.log(`agenda-continua: ${passou} passaram, ${erros.length} falharam`);
if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
