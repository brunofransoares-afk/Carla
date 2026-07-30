/*
 * Bateria da ordem em que os horários são oferecidos.
 *
 * Caso real, 30/07 às 18:11. O Dr. Bruno tinha aberto no painel três horários pra o dia
 * seguinte: 31/07 às 14h, 16h e 18h. A conversa foi assim:
 *
 *   família  "Amanha a tarde nao tem nenhum?"
 *   Carla    "Não, amanhã à tarde não tenho nada livre. O único horário de amanhã é às
 *             11h mesmo. A próxima opção seria segunda-feira (03/08) às 14h."
 *
 * Os extras existiam e eram encontrados. O que falhava era a ordem: a lista era
 * [ ...seis da grade, ...os extras ] e o chamador ficava com os 2 primeiros. Como a
 * função da grade não filtra de verdade (completa com o resto até o total pedido), os
 * seis primeiros sempre eram da grade e os extras nunca chegavam a ser olhados.
 *
 * Roda com:  node tests/ordem-dos-horarios.test.js
 */
"use strict";
const path = require("path");
const { ordenarCandidatos } = require(path.join(__dirname, "..", "ordem-dos-horarios.js"));

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

// weekday: 5 = sexta, 1 = segunda, 2 = terça, 4 = quinta
const g = (date, time, weekday) => ({ id: `${date}T${time}`, date, time, weekday, label: `${date} ${time}` });
const x = (date, time) => ({ id: `extra-${date}-${time}`, date, time, label: `${date} ${time} (extra)`, extra: true });
const rotulos = (lista) => lista.map((s) => s.label);

// ------------------------------------------------- 1. o caso que aconteceu
{
  // A grade devolveu 6 horários, NENHUM na sexta à tarde (ela completa com o resto).
  const grade = [
    g("2026-07-31", "08:00", 5), g("2026-08-03", "14:00", 1), g("2026-08-04", "08:00", 2),
    g("2026-08-06", "08:00", 4), g("2026-08-07", "08:00", 5), g("2026-08-10", "08:00", 1),
  ];
  const extras = [x("2026-07-31", "14:00"), x("2026-07-31", "16:00"), x("2026-07-31", "18:00")];
  const filtros = { periodo: "tarde", dataPreferida: "2026-07-31" };

  const antes = [...grade, ...extras].slice(0, 2);
  eq(rotulos(antes).join(" | "), "2026-07-31 08:00 | 2026-08-03 14:00",
    "1. (o comportamento antigo, pra deixar registrado o que quebrava)");

  const depois = ordenarCandidatos(grade, extras, filtros).slice(0, 2);
  eq(rotulos(depois).join(" | "), "2026-07-31 14:00 (extra) | 2026-07-31 16:00 (extra)",
    "1. amanhã à tarde passa a oferecer os horários abertos no painel");
}

// ------------------------------------------------- 2. o que não bate continua existindo
{
  const grade = [g("2026-08-03", "14:00", 1), g("2026-08-04", "08:00", 2)];
  const extras = [x("2026-07-31", "16:00")];
  const r = ordenarCandidatos(grade, extras, { periodo: "tarde", dataPreferida: "2026-07-31" });
  eq(rotulos(r)[0], "2026-07-31 16:00 (extra)", "2. o que bate vem primeiro");
  eq(r.length, 3, "2. o que não bate continua na lista, como alternativa");
  eq(rotulos(r)[1], "2026-08-03 14:00", "2. e vem depois, na ordem que a grade já tinha");
}

// ------------------------------------------------- 3. grade e extra que batem se misturam por tempo
{
  const grade = [g("2026-07-31", "15:00", 5), g("2026-08-03", "08:00", 1)];
  const extras = [x("2026-07-31", "14:00")];
  const r = ordenarCandidatos(grade, extras, { periodo: "tarde", dataPreferida: "2026-07-31" });
  eq(rotulos(r).slice(0, 2).join(" | "), "2026-07-31 14:00 (extra) | 2026-07-31 15:00",
    "3. entre os que batem, o mais cedo vem antes — extra não tem prioridade nem penalidade");
}

// ------------------------------------------------- 4. sem filtro, o extra de amanhã não fica atrás
{
  const grade = [g("2026-07-31", "08:00", 5), g("2026-08-03", "14:00", 1)];
  const extras = [x("2026-07-31", "14:00")];
  const r = ordenarCandidatos(grade, extras, {});
  eq(rotulos(r).slice(0, 2).join(" | "), "2026-07-31 08:00 | 2026-07-31 14:00 (extra)",
    "4. sem pedido específico, tudo se ordena por tempo: o de amanhã antes do da semana que vem");
}

// ------------------------------------------------- 5. filtro por dia da semana
{
  const grade = [g("2026-08-03", "08:00", 1), g("2026-08-04", "08:00", 2)];
  const extras = [x("2026-07-31", "14:00")];  // extras já chegam filtrados por quem buscou
  const r = ordenarCandidatos(grade, extras, { diaPreferido: 5 });
  eq(rotulos(r)[0], "2026-07-31 14:00 (extra)", "5. pedindo sexta, o extra de sexta vem primeiro");
}

// ------------------------------------------------- 6. período sozinho
{
  const grade = [g("2026-08-03", "08:00", 1), g("2026-08-03", "14:00", 1)];
  const extras = [x("2026-07-31", "16:00")];
  const r = ordenarCandidatos(grade, extras, { periodo: "tarde" });
  eq(rotulos(r).slice(0, 2).join(" | "), "2026-07-31 16:00 (extra) | 2026-08-03 14:00",
    "6. pedindo tarde, só horário de tarde vem na frente, em ordem de tempo");
}

// ------------------------------------------------- 7. listas vazias não quebram
{
  eq(ordenarCandidatos([], [], {}).length, 0, "7. tudo vazio devolve vazio");
  eq(rotulos(ordenarCandidatos([], [x("2026-07-31", "14:00")], { periodo: "tarde" }))[0],
    "2026-07-31 14:00 (extra)", "7. só extras funciona");
  eq(ordenarCandidatos(undefined, undefined, undefined).length, 0, "7. sem argumento nenhum não quebra");
}

// ------------------------------------------------- 8. nada bate: a alternativa sobrevive
{
  const grade = [g("2026-08-03", "08:00", 1), g("2026-08-04", "08:00", 2)];
  const r = ordenarCandidatos(grade, [], { periodo: "tarde", dataPreferida: "2026-07-31" });
  eq(r.length, 2, "8. sem nada batendo, a família ainda recebe alternativa em vez de silêncio");
  eq(rotulos(r)[0], "2026-08-03 08:00", "8. e na ordem que a grade já tinha escolhido");
}

console.log(erros.map((e) => "  FALHA " + e).join("\n"));
console.log(`ordem-dos-horarios: ${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
