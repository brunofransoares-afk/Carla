/*
 * Bateria: a grade de horários do consultório, incluindo os que só existem em algumas
 * semanas do mês.
 *
 * O dono, em 01/10/2026, passou a grade dia a dia. Dois dos cinco dias têm exceção por
 * ocorrência no mês, e é aí que isto fica perigoso:
 *
 *   - QUINTA: 8h, 10h, 14h30 e 16h30, mas o 16h30 SÓ nas 2ª e 4ª quintas.
 *   - SEXTA: 10h, 14h30, 16h30 e 18h, mas nas 2ª e 4ª sextas só existe o 10h.
 *
 * POR QUE ISTO VIROU LISTA E NÃO CONTINUOU SENDO JANELA. Antes a grade eram faixas ("das 8
 * às 12") e os horários saíam de duração mais intervalo. A grade nova tem buraco de propósito
 * (10h e depois 14h30, nada no meio) e horas que não caem em passo nenhum. Horário de
 * consultório é escolha, não progressão aritmética.
 *
 * E A EXCEÇÃO RESTRINGE, NUNCA ACRESCENTA. "Este horário só nas 2ª e 4ª quintas" é diferente
 * de "nas 2ª e 4ª quintas também tem isso": se acrescentasse, um erro de digitação criaria
 * horário onde não existe atendimento, e alguém apareceria no consultório num dia em que o
 * Dr. Bruno não está. Restringindo, o pior caso é oferecer menos.
 *
 * Roda com:  node tests/grade-do-consultorio.test.js
 */
"use strict";
const path = require("path");
require(path.join(__dirname, "..", "carla-app", "js", "config.js"));
const Agenda = require(path.join(__dirname, "..", "carla-app", "js", "agenda.js"));

let passou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const dia = (ano, mes, d) => new Date(ano, mes - 1, d);
const horas = (d) => Agenda.horariosDoDia(d).join(", ");

// ------------------------------------------------- 1. os dias simples
{
  eq(horas(dia(2026, 10, 5)), "10:00, 14:30, 16:30", "1. segunda");
  eq(horas(dia(2026, 10, 6)), "10:00, 14:30", "1b. terça");
  eq(horas(dia(2026, 10, 7)), "", "1c. quarta não tem atendimento");
  eq(horas(dia(2026, 10, 3)), "", "1d. sábado não tem horário fixo: é urgência com valor próprio, por escalonamento");
  eq(horas(dia(2026, 10, 4)), "", "1e. domingo também não");

  // E valem em qualquer semana do mês: só quinta e sexta têm exceção.
  for (const d of [5, 12, 19, 26]) {
    eq(horas(dia(2026, 10, d)), "10:00, 14:30, 16:30", "1f. segunda " + d + "/10 é igual a todas as outras");
  }
}

// ------------------------------------------------- 2. a quinta, e o 16h30 que vai e vem
{
  // Outubro de 2026: quintas em 1, 8, 15, 22 e 29.
  eq(horas(dia(2026, 10, 1)), "08:00, 10:00, 14:30", "2. 1ª quinta: sem o 16h30");
  eq(horas(dia(2026, 10, 8)), "08:00, 10:00, 14:30, 16:30", "2b. 2ª quinta: com o 16h30");
  eq(horas(dia(2026, 10, 15)), "08:00, 10:00, 14:30", "2c. 3ª quinta: sem");
  eq(horas(dia(2026, 10, 22)), "08:00, 10:00, 14:30, 16:30", "2d. 4ª quinta: com");
  eq(horas(dia(2026, 10, 29)), "08:00, 10:00, 14:30", "2e. 5ª quinta: sem");

  // O resto da quinta não depende da semana: só o 16h30 é que entra e sai.
  for (const d of [1, 8, 15, 22, 29]) {
    const lista = Agenda.horariosDoDia(dia(2026, 10, d));
    ok(["08:00", "10:00", "14:30"].every((h) => lista.includes(h)),
      "2f. quinta " + d + "/10 mantém os três fixos");
  }
}

// ------------------------------------------------- 3. a sexta, e a tarde que some
{
  // Outubro de 2026: sextas em 2, 9, 16, 23 e 30.
  eq(horas(dia(2026, 10, 2)), "10:00, 14:30, 16:30, 18:00", "3. 1ª sexta: tudo");
  eq(horas(dia(2026, 10, 9)), "10:00", "3b. 2ª sexta: só o 10h");
  eq(horas(dia(2026, 10, 16)), "10:00, 14:30, 16:30, 18:00", "3c. 3ª sexta: tudo");
  eq(horas(dia(2026, 10, 23)), "10:00", "3d. 4ª sexta: só o 10h");
  eq(horas(dia(2026, 10, 30)), "10:00, 14:30, 16:30, 18:00", "3e. 5ª sexta: tudo");

  // O 10h nunca some: é o que sobra nas sextas curtas.
  for (const d of [2, 9, 16, 23, 30]) {
    ok(Agenda.horariosDoDia(dia(2026, 10, d)).includes("10:00"), "3f. sexta " + d + "/10 tem o 10h");
  }
}

// ------------------------------------------------- 4. a conta da ocorrência
{
  // Pelo dia do mês, e não por semana do calendário: é a conta que a pessoa faz olhando o
  // calendário, e não muda quando o mês começa no meio da semana.
  eq(Agenda.ocorrenciaNoMes(dia(2026, 10, 1)), 1, "4. dia 1 é a primeira ocorrência");
  eq(Agenda.ocorrenciaNoMes(dia(2026, 10, 7)), 1, "4b. dia 7 ainda é a primeira");
  eq(Agenda.ocorrenciaNoMes(dia(2026, 10, 8)), 2, "4c. dia 8 já é a segunda");
  eq(Agenda.ocorrenciaNoMes(dia(2026, 10, 29)), 5, "4d. dia 29 é a quinta");

  // FEVEREIRO COMEÇANDO NUMA SEGUNDA e MARÇO COMEÇANDO NUM DOMINGO: dois meses em que
  // "semana do mês" e "ocorrência do dia da semana" dariam respostas diferentes.
  eq(Agenda.ocorrenciaNoMes(dia(2027, 2, 4)), 1, "4e. 04/02/2027 (quinta) é a 1ª quinta");
  eq(horas(dia(2027, 2, 4)), "08:00, 10:00, 14:30", "4e2. e por isso não tem 16h30");
  eq(Agenda.ocorrenciaNoMes(dia(2027, 2, 11)), 2, "4f. 11/02/2027 é a 2ª quinta");
  eq(horas(dia(2027, 2, 11)), "08:00, 10:00, 14:30, 16:30", "4f2. e por isso tem");
}

// ------------------------------------------------- 5. a grade de verdade, pela agenda
{
  // Uma quarta-feira, pra olhar as semanas seguintes inteiras.
  const now = new Date(2026, 9, 7, 6, 0);
  const livres = Agenda.disponiveis(now, new Set());
  ok(livres.length > 20, "5. a agenda produz horários");
  ok(livres.every((s) => Agenda.horariosDoDia(new Date(...s.date.split("-").map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))))).includes(s.time)),
    "5b. e todo horário oferecido existe na grade do dia dele");
  ok(!livres.some((s) => s.weekday === 3), "5c. nenhuma quarta aparece");
  ok(!livres.some((s) => s.weekday === 0 || s.weekday === 6), "5d. nem sábado, nem domingo");

  const sextasCurtas = livres.filter((s) => s.weekday === 5 && [2, 4].includes(Math.floor((Number(s.date.slice(8)) - 1) / 7) + 1));
  ok(sextasCurtas.every((s) => s.time === "10:00"),
    "5e. nas 2ª e 4ª sextas, a agenda só oferece o 10h");
  const quintasSemTarde = livres.filter((s) => s.weekday === 4 && [1, 3, 5].includes(Math.floor((Number(s.date.slice(8)) - 1) / 7) + 1));
  ok(quintasSemTarde.every((s) => s.time !== "16:30"),
    "5f. e nas 1ª, 3ª e 5ª quintas, nunca o 16h30");
}

// ------------------------------------------------- 6. os irmãos, com a grade esburacada
{
  // "Seguido" passou a ser uma pergunta sobre a DISTÂNCIA entre dois horários, e não sobre
  // serem vizinhos na lista: 10h e 14h30 são vizinhos e não servem pra ninguém.
  const par = Agenda.doisSeguidos(new Date(2026, 9, 7, 6, 0), new Set());
  ok(par, "6. existe par de horários seguidos");
  if (par) {
    const minutos = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
    eq(par[0].date, par[1].date, "6b. no mesmo dia");
    ok(minutos(par[1].time) - minutos(par[0].time) <= 90,
      "6c. e realmente seguidos: no máximo uma consulta mais o intervalo de distância (" + par[0].time + " e " + par[1].time + ")");
  }
}

// ------------------------------------------------- 7. o ajuste de 30 minutos, sem janelas
{
  const base = { id: "2026-10-05T14:30", date: "2026-10-05", time: "14:30", weekday: 1 };
  const cedo = new Date(2026, 9, 1, 8, 0);
  ok(Agenda.ajustarHorario(cedo, base, "15:00", []).ok, "7. 14h30 pra 15h cabe no dia");
  const foraDoDia = Agenda.ajustarHorario(cedo, { ...base, time: "10:00", id: "2026-10-05T10:00" }, "09:30", []);
  ok(!foraDoDia.ok && /fora do período/.test(foraDoDia.motivo || ""),
    "7b. mas 10h pra 9h30 fica antes de o consultório abrir naquele dia");
  const semAtendimento = Agenda.ajustarHorario(cedo, { id: "x", date: "2026-10-07", time: "10:00", weekday: 3 }, "10:30", []);
  ok(!semAtendimento.ok && /não tem atendimento/.test(semAtendimento.motivo || ""),
    "7c. e numa quarta não existe ajuste nenhum: não há expediente");
}

console.log(`grade-do-consultorio: ${passou} passaram, ${erros.length} falharam`);
if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
