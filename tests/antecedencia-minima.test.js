/*
 * Bateria: a agenda precisa de antecedência, e não só de "ainda não começou".
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

// ------------------------------------------------- 1. a grade
{
  ok(horariosDeHoje(as(9, 55)).indexOf("11:00") >= 0,
    "1. às 09:55, o horário das 11h ainda é oferecido (65 minutos é antecedência suficiente)");
  ok(horariosDeHoje(as(10, 50)).indexOf("11:00") < 0,
    "1b. às 10:50 ele some: é o caso exato que o dono descreveu");
  ok(horariosDeHoje(as(10, 0)).indexOf("11:00") >= 0,
    "1c. exatamente 60 minutos ainda vale: a trava é 'pelo menos uma hora', não 'mais de'");
  ok(horariosDeHoje(as(10, 1)).indexOf("11:00") < 0,
    "1d. e um minuto a menos já não vale");
  ok(horariosDeHoje(as(10, 50)).indexOf("14:00") >= 0,
    "1e. o resto do dia continua de pé: a trava é do horário de perto, não do dia inteiro");
  eq(horariosDeHoje(as(16, 0)).length, 0,
    "1f. no fim da tarde não sobra horário de hoje, e isso não é erro");

  // A conferência não é mais "só hoje". Uma janela que atravessasse a meia-noite deixaria
  // um buraco de uma hora do outro lado, e buraco que depende do relógio é o pior tipo.
  const FONTE = fs.readFileSync(path.join(__dirname, "..", "carla-app", "js", "agenda.js"), "utf8");
  ok(!/if \(i === 0\) \{[\s\S]{0,200}slotDate <= now/.test(FONTE),
    "1g. a conferência de hoje virou conferência sempre");
  eq((FONTE.match(/temAntecedencia\(/g) || []).length >= 4, true,
    "1h. e ela é usada nos quatro caminhos da agenda, não só no primeiro");
}

// ------------------------------------------------- 2. o par de horários seguidos (irmãos)
{
  const parCedo = Agenda.doisSeguidos(as(6, 0), new Set());
  ok(parCedo && parCedo[0].date === SEGUNDA && parCedo[0].time === "08:00",
    "2. de madrugada, o par dos irmãos começa às 8h");
  const parTarde = Agenda.doisSeguidos(as(7, 30), new Set());
  ok(parTarde && !(parTarde[0].date === SEGUNDA && parTarde[0].time === "08:00"),
    "2b. às 07:30 o par das 8h já não serve: meia hora não dá tempo de trazer duas crianças");
}

// ------------------------------------------------- 3. o ajuste de até 30 minutos
{
  // Base 11h, e o ajuste pedido é 10h30: cabe na janela da manhã (10:30 + 1h fecha às 11:30,
  // antes do meio-dia), então o que decide é só a antecedência.
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
    "4. o extra aberto no painel passa pela MESMA conta da grade");
  ok(!/return new Date\(ano, mes - 1, dia, h, m\) > now;/.test(FONTE),
    "4b. e a comparação antiga, que só olhava se tinha começado, saiu");
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
