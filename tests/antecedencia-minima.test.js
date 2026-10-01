/*
 * Bateria: a agenda precisa de antecedência, e a GRADE não oferece hoje de jeito nenhum.
 *
 * O dono, em 25/09: "se eu tenho um horario as 11h em aberto, e ja for 10h, ela nao pode
 * marcar. tem q ter ai uma trava de 1 h pelomenos, pq as vezes eu nem to no consultorio e sao
 * 10 e 50 e ela marca pra 11".
 *
 * A única trava que existia era o horário não ter COMEÇADO: às 10h50 um horário de 11h ainda
 * era oferecível e reservável. Só que quem marca precisa sair de casa e quem atende precisa
 * estar lá. Um horário que começa em dez minutos não é horário livre.
 *
 * O QUE ESTE ARQUIVO GUARDA, e por que são cinco lugares e não um:
 *
 *   1. A GRADE, na hora de oferecer.
 *   2. OS HORÁRIOS ABERTOS À MÃO no painel, que não são mais fáceis de cumprir por serem extras.
 *   3. O PAR DE HORÁRIOS SEGUIDOS dos irmãos, que tem caminho próprio na agenda.
 *   4. O AJUSTE DE ATÉ 30 MINUTOS, que pode empurrar um horário válido pra dentro da janela.
 *   5. A RESERVA. Este é o que fecha: entre oferecer e confirmar passa uma conversa inteira,
 *      e um horário de 11h oferecido às 10h05 chega no confirmar_agendamento às 10h50 se
 *      ninguém olhar o relógio outra vez.
 *
 * E EM 01/10/2026 ENTROU UMA REGRA MAIS FORTE POR CIMA. O dono: "eu vou pedir para você
 * parar de oferecer datas do dia de hoje. Nunca ofereça datas do dia atual." Vale pra
 * urgência também.
 *
 * AS DUAS REGRAS CONVIVEM, E A DIFERENÇA ENTRE ELAS É O PRODUTO INTEIRO DO ENCAIXE:
 *
 *   - A GRADE nunca mostra hoje. É o que a Carla oferece sozinha.
 *   - O HORÁRIO ABERTO À MÃO no painel PODE ser hoje, e ali só a antecedência mínima vale.
 *     É o que o Dr. Bruno autoriza quando responde um pedido de encaixe.
 *
 * Se alguém "uniformizar" isso e fizer a regra de hoje valer também pros extras, o encaixe
 * para de funcionar em silêncio: ele abre o horário, e a Carla não acha. Tem teste abaixo.
 *
 * Um pedido dentro da janela não vira recusa seca: vira escalar_humano. Quem abre exceção é
 * o Dr. Bruno, não a Carla.
 *
 * Roda com:  node tests/antecedencia-minima.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

require(path.join(__dirname, "..", "carla-app", "js", "config.js"));
const Agenda = require(path.join(__dirname, "..", "carla-app", "js", "agenda.js"));
const MINIMO = global.CARLA_CONFIG.antecedenciaMinimaMin;

// Segunda-feira, 28/09/2026. A grade do dia: 08:00, 09:30, 11:00 (manhã) e 14:00, 15:30.
const SEGUNDA = "2026-09-28";
const as = (h, m) => new Date(2026, 8, 28, h, m);
const horariosDeHoje = (now) => Agenda.disponiveis(now, new Set())
  .filter((s) => s.date === SEGUNDA).map((s) => s.time);

// ------------------------------------------------- 0. a configuração existe e é uma hora
{
  eq(MINIMO, 60, "0. a antecedência mínima é de uma hora, como o dono pediu");
  ok(typeof Agenda.temAntecedencia === "function", "0b. e a conta mora num lugar só, exportada");
}

// ------------------------------------------------- 1. a grade não oferece hoje, nunca
{
  eq(horariosDeHoje(as(6, 0)).length, 0,
    "1. de madrugada, a grade não tem nenhum horário de hoje");
  eq(horariosDeHoje(as(9, 55)).length, 0,
    "1b. às 09:55 também não: o das 11h existia e saiu junto com o dia");
  ok(Agenda.disponiveis(as(6, 0), new Set()).length > 10,
    "1c. mas os outros dias continuam cheios: a regra é do dia de hoje, não da agenda");
  const primeiro = Agenda.disponiveis(as(6, 0), new Set())[0];
  ok(primeiro && primeiro.date > SEGUNDA,
    "1d. e o mais cedo que existe é depois de hoje (" + (primeiro && primeiro.date) + ")");

  const FONTE = fs.readFileSync(path.join(__dirname, "..", "carla-app", "js", "agenda.js"), "utf8");
  ok(/function ehDiaOferecivelPelaGrade/.test(FONTE),
    "1e. a regra da grade tem nome próprio, separada da antecedência");
  eq((FONTE.match(/ehDiaOferecivelPelaGrade\(/g) || []).length >= 3, true,
    "1f. e é usada na grade e no par dos irmãos, não só num lugar");
  ok(/grade: \{ nuncaHoje: true \}/.test(fs.readFileSync(path.join(__dirname, "..", "carla-app", "js", "config.js"), "utf8")),
    "1g. e a decisão está no config, com o motivo escrito");
}

// ------------------------------------------------- 2. o par de horários seguidos (irmãos)
{
  const parCedo = Agenda.doisSeguidos(as(6, 0), new Set());
  ok(parCedo && parCedo[0].date > SEGUNDA,
    "2. o par dos irmãos também não é hoje, nem de madrugada");
  ok(parCedo && parCedo[0].date === parCedo[1].date && parCedo[0].time < parCedo[1].time,
    "2b. e continua sendo um par de verdade: mesmo dia, um depois do outro");
}

// ------------------------------------------------- 3. o ajuste de até 30 minutos
{
  // O AJUSTE CONTINUA SENDO SOBRE ANTECEDÊNCIA, e não sobre o dia: ele acontece em cima de
  // um horário que a Carla já ofereceu, e um horário aberto à mão pelo Dr. Bruno pode ser
  // hoje. Por isso a base aqui é um horário de hoje: é o caso do encaixe autorizado.
  const base = { id: SEGUNDA + "T11:00", date: SEGUNDA, time: "11:00", weekday: 1 };
  const cedo = Agenda.ajustarHorario(as(7, 0), base, "10:30", []);
  ok(cedo.ok, "3. às 07:00, ajustar 11h para 10h30 é permitido");
  const emCima = Agenda.ajustarHorario(as(10, 15), base, "10:30", []);
  ok(!emCima.ok, "3b. às 10:15 não é: o ajuste de 30 minutos não é porta de exceção");
  ok(/antecedência/.test(emCima.motivo || ""), "3c. e o motivo diz por quê, pra ela saber o que responder");
  const aindaPassou = Agenda.ajustarHorario(as(11, 30), base, "10:30", []);
  ok(!aindaPassou.ok && /já passou/.test(aindaPassou.motivo || ""),
    "3d. horário que já passou continua com o motivo próprio dele, que é outro");
}

// ------------------------------------------------- 4. os horários abertos à mão no painel
{
  const FONTE = fs.readFileSync(path.join(__dirname, "..", "storage-node.js"), "utf8");
  ok(/Agenda\.temAntecedencia\(new Date\(ano, mes - 1, dia, h, m\), now\)/.test(FONTE),
    "4. o extra aberto no painel passa pela antecedência mínima");
  ok(!/return new Date\(ano, mes - 1, dia, h, m\) > now;/.test(FONTE),
    "4b. e a comparação antiga, que só olhava se tinha começado, saiu");

  /*
   * MAS O EXTRA NÃO PASSA PELA REGRA DE HOJE, e isto é o contrário de um descuido: é o que
   * faz o encaixe existir. O Dr. Bruno responde "consigo às 15h", o painel abre o horário de
   * HOJE, e a Carla precisa achá-lo pra oferecer. Se alguém uniformizar as duas regras aqui,
   * o encaixe quebra em silêncio: o horário é aberto e some.
   */
  ok(!/ehDiaOferecivelPelaGrade/.test(FONTE),
    "4c. o extra NÃO usa a regra da grade: horário aberto à mão pode ser hoje, e é isso que o encaixe é");
}

// ------------------------------------------------- 5. a reserva, que é a que fecha
{
  const FONTE = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
  const bloco = FONTE.slice(FONTE.indexOf('if (nome === "confirmar_agendamento")'),
    FONTE.indexOf('if (nome === "registrar_dados_do_paciente")'));
  ok(/Agenda\.temAntecedencia\(inicioDoSlot, ctx\.now\)/.test(bloco),
    "5. confirmar_agendamento confere a antecedência de novo, com o relógio da hora da reserva");
  ok(/escalar_humano/.test(bloco.slice(bloco.indexOf("temAntecedencia"), bloco.indexOf("temAntecedencia") + 900)),
    "5b. e a recusa manda escalar, em vez de só dizer não: quem abre exceção é o Dr. Bruno");
  ok(/NÃO marque/.test(bloco),
    "5c. com a ordem de não marcar dita sem rodeio, que é o que ela tem que obedecer");

  // A trava vem ANTES de qualquer coisa que grave. Uma conferência depois da escrita é uma
  // conferência que não impede nada.
  const posTrava = bloco.indexOf("temAntecedencia");
  const posGravar = bloco.indexOf("Storage.salvarAgendamento");
  ok(posTrava > 0 && (posGravar < 0 || posTrava < posGravar),
    "5d. e ela vem antes de gravar, senão não impede nada");
}

// ------------------------------------------------- 6. a conta, isolada
{
  const agora = as(10, 0);
  ok(Agenda.temAntecedencia(as(11, 0), agora), "6. uma hora exata passa");
  ok(!Agenda.temAntecedencia(as(10, 59), agora), "6b. 59 minutos não");
  ok(Agenda.temAntecedencia(as(23, 0), agora), "6c. o resto do dia passa");
  ok(!Agenda.temAntecedencia(as(9, 0), agora), "6d. e o que já passou, claro, não");
}

console.log(`\n${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
console.log("OK — a agenda exige " + MINIMO + " minutos de antecedência, em todos os caminhos.");
