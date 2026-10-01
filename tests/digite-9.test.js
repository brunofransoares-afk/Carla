/*
 * Bateria: "Qualquer dificuldade, digite 9", a abertura nova e a duração do neuro.
 *
 * O dono (2026-10-01) mandou a abertura exata, com a linha "Qualquer dificuldade, digite 9.",
 * e: "Se a pessoa digitar apenas '9' em uma mensagem, manda a msg de escalar, escala e
 * silencia. Cuidado pra não considerar 9 em outras msgs como datas e etc." E: "a consulta de
 * neurodivergência coloca 1 hora e meia de duração."
 *
 * Roda com:  node tests/digite-9.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { pediuAjuda, MENSAGEM } = require("../pedido-de-ajuda.js");

let passou = 0;
const erros = [];
function ok(cond, nome) { if (typeof nome !== "string") throw new Error("ok(cond, nome)"); if (cond) passou++; else erros.push(nome); }

const ABERTURA = { role: "assistant", content: "Boa tarde! 😊\n\nSeja bem-vindo ao consultório do Dr. Bruno Soares, pediatra. Meu nome é Carla. Sou a secretária, e este atendimento é automatizado no primeiro momento.\n\nPor aqui eu te passo as informações das consultas e dos valores, e já faço o seu agendamento.\n\nQualquer dificuldade, digite 9.\n\nComo posso ajudar você hoje?" };
const carla = (texto) => ({ historico: [{ role: "user", content: "oi" }, { role: "assistant", content: texto }] });

// ------------------------------------------------- 1. o 9 sozinho escala
ok(pediuAjuda("9", { historico: [ABERTURA] }), "1. '9' logo depois da abertura escala (a 'Boa tarde' da saudação não conta como pergunta de período)");
ok(pediuAjuda(" 9 ", {}) && pediuAjuda("9.", {}) && pediuAjuda("9!", {}), "1b. com espaço ou ponto ainda é o 9 sozinho");
ok(pediuAjuda("9", carla("O atendimento é particular. A consulta de puericultura é R$ 450. Posso te ajudar com mais alguma coisa?")),
  "1c. no meio da conversa também, quando a pergunta dela não era de dia nem hora");

// ------------------------------------------------- 2. o 9 que é outra coisa
for (const t of ["dia 9", "9h", "às 9", "9:30", "09/10", "99", "19", "9 meses", "R$ 90", "9 9", "opção 9"]) {
  ok(!pediuAjuda(t, {}), `2. "${t}" não é o 9 sozinho`);
}
for (const [pergunta, nome] of [
  ["Você prefere de manhã ou à tarde?", "período"],
  ["Qual dia fica melhor pra você?", "dia"],
  ["Que horário você prefere?", "horário"],
  ["Quantos meses ele tem?", "idade em meses"],
  ["Qual a idade da criança?", "idade"],
  ["Pode ser às 10h ou às 14:30?", "hora com número"],
]) {
  ok(!pediuAjuda("9", carla(pergunta)), `2b. '9' respondendo pergunta de ${nome} não escala`);
}
ok(!pediuAjuda("9", { historico: [ABERTURA], horariosOferecidos: [{ id: "x" }] }), "2c. com horários oferecidos na mesa, o 9 é escolha, não pedido de ajuda");

// ------------------------------------------------- 3. o servidor escala, avisa e silencia
const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const conversa = SERVER.slice(SERVER.indexOf("async function processarMensagem("), SERVER.indexOf("async function enviarLembretes("));
const bloco = conversa.slice(conversa.indexOf("if (PedidoDeAjuda.pediuAjuda("), conversa.indexOf("const ehPrimeiraMensagemDaConversa"));
ok(bloco.length > 0, "3. a regra roda na conversa");
ok(/sessao\.aguardandoHumano = true;/.test(bloco), "3b. silencia a Carla");
ok(/Storage\.registrarAlertaUrgencia\(/.test(bloco), "3c. vira alerta no painel");
ok(/notificarAtencao\(sock,/.test(bloco), "3d. e aviso no seu WhatsApp");
ok(/await enviarResposta\(sock, jid, telefone, PedidoDeAjuda\.MENSAGEM, semAtraso\);\s*return;\s*\}/.test(bloco), "3e. manda a mensagem de escalar e para, sem chamar a IA");
const pSilencio = conversa.indexOf("if (sessao.aguardandoHumano) {");
const pNove = conversa.indexOf("if (PedidoDeAjuda.pediuAjuda(");
const pIA = conversa.indexOf("await CerebroIA.responder(");
const pEmergencia = conversa.indexOf("avaliarEmergencia(texto)");
ok(pEmergencia > 0 && pSilencio > pEmergencia && pNove > pSilencio && pIA > pNove,
  "3f. depois da emergência e do silêncio (quem já espera você não escala de novo), antes da IA");
ok(/consultório/.test(MENSAGEM) && /retorno/.test(MENSAGEM) && !/—/.test(MENSAGEM), "3g. a mensagem diz que encaminhou e que retorna, sem travessão");

// ------------------------------------------------- 4. a abertura e a duração
const CEREBRO = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
const textoAbertura = "Seja bem-vindo ao consultório do Dr. Bruno Soares, pediatra. Meu nome é Carla. Sou a secretária, e este atendimento é automatizado no primeiro momento.\n\nPor aqui eu te passo as informações das consultas e dos valores, e já faço o seu agendamento.\n\nQualquer dificuldade, digite 9.\n\nComo posso ajudar você hoje?";
ok(CEREBRO.includes(textoAbertura), "4. a abertura é o texto do dono, palavra por palavra");
ok(!/O que eu não resolver, eu encaminho no consultório e te retorno/.test(CEREBRO), "4b. a frase antiga saiu");
ok(/A parte 4 \("Qualquer dificuldade, digite 9\."\) continua/.test(CEREBRO), "4c. o atalho do 9 fica mesmo quando a pessoa já chegou perguntando");
ok(/emende o formato COM A DURAÇÃO DELA \("Tem duração média de 1 hora e meia, com uma avaliação completa e individualizada\."\)/.test(CEREBRO),
  "4d. neurodesenvolvimento: 1 hora e meia");
ok(/Puericultura: comece por[^\n]*emende o formato e feche/.test(CEREBRO) && /"Tem duração média de 1 hora, com uma avaliação/.test(CEREBRO),
  "4e. puericultura continua 1 hora");

console.log(`digite-9: ${passou} passaram, ${erros.length} falharam`);
if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
