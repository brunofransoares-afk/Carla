/*
 * Bateria: urgência que não pode esperar vai pro Dr. Bruno na hora, sem repetir horário.
 *
 * O print (2026-10-02): mãe escolheu urgência, a Carla ofereceu segunda-feira e repetiu os
 * mesmos horários três vezes, inventou "já busquei com prioridade máxima" e ficou pedindo
 * nome. A mãe: "você precisa responder que vai ver com o dr, apenas isso". O dono: "eu não
 * havia pedido pra, caso a pessoa quiser a consulta de urgência e pedir encaixe, você
 * simplesmente redirecionar pra mim?"
 *
 * Roda com:  node tests/encaixe-de-urgencia.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { pediuEncaixe, MENSAGEM } = require("../pedido-de-encaixe.js");

let passou = 0;
const erros = [];
function ok(cond, nome) { if (typeof nome !== "string") throw new Error("ok(cond, nome)"); if (cond) passou++; else erros.push(nome); }

const URG = { tipoTravado: "urgencia" };

// ------------------------------------------------- 1. as frases do print escalam
for (const [frase, extra] of [
  ["Ue eh consulta de urgência, nao da pra esperar ate segunda ne", {}],
  ["Vc nao consegue pedir um encaixe pro dr?", URG],
  ["Vc precisa responder que vai ver com o dr !!! Apenas isso", URG],
  ["Vc nao ta entendendo que é urgente?", URG],
]) ok(pediuEncaixe(frase, extra), `1. escala: "${frase}"`);

// ------------------------------------------------- 2. outros jeitos de pedir o mesmo
for (const frase of ["tem pra hoje?", "o quanto antes, por favor", "não tem nada antes?", "não dá pra segunda", "não posso esperar", "precisa ser ainda hoje", "fala com o doutor"]) {
  ok(pediuEncaixe(frase, URG), `2. na urgência, escala: "${frase}"`);
}
ok(pediuEncaixe("quero uma consulta de urgência pra hoje", {}), "2b. a própria mensagem dizendo urgência + hoje já basta, antes de o tipo travar");

// ------------------------------------------------- 3. o que NÃO escala
for (const frase of ["Tarde", "pode ser segunda às 10h", "Ana Souza e Maria", "ele está com febre desde ontem", "Pix"]) {
  ok(!pediuEncaixe(frase, URG), `3. segue a conversa normal: "${frase}"`);
}
ok(!pediuEncaixe("tem hoje?", { tipoTravado: "puericultura" }), "3b. fora da urgência, a trava não age (o pedido de hoje dos outros tipos segue a regra do prompt)");
ok(!pediuEncaixe("", URG), "3c. mensagem vazia não escala");

// ------------------------------------------------- 4. o servidor
const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const turno = SERVER.slice(SERVER.indexOf("async function processarMensagem("), SERVER.indexOf("async function enviarLembretes("));
const bloco = turno.slice(turno.indexOf("if (PedidoDeEncaixe.pediuEncaixe("), turno.indexOf("const ehPrimeiraMensagemDaConversa"));
ok(/Preco\.tipoDoValor\(EstadoAtendimento\.primeiroPrecoInformado\(sessao\.estadoAtendimento\)\)/.test(turno), "4. o tipo vem do primeiro valor informado, que é o que trava a conversa");
ok(/sessao\.aguardandoHumano = true;/.test(bloco), "4b. silencia");
ok(/assunto: "encaixe"/.test(bloco) && /dataPedida: Agenda\.toDateStr\(now\)/.test(bloco), "4c. vira alerta de encaixe de hoje (o painel dá o campo de horário)");
ok(/notificarAtencao\(sock, \{\s*tipo: "encaixe"/.test(bloco), "4d. com o aviso de '⏱️ Encaixe pra HOJE' no WhatsApp dele");
ok(/await enviarResposta\(sock, jid, telefone, PedidoDeEncaixe\.MENSAGEM, semAtraso\);\s*return;/.test(bloco), "4e. manda a mensagem e para, sem a IA");
const pSilencio = turno.indexOf("if (sessao.aguardandoHumano) {");
const pEncaixe = turno.indexOf("if (PedidoDeEncaixe.pediuEncaixe(");
const pIA = turno.indexOf("await CerebroIA.responder(");
ok(pSilencio > 0 && pEncaixe > pSilencio && pIA > pEncaixe, "4f. depois do silêncio (quem já espera não escala de novo), antes da IA");
ok(MENSAGEM === "Irei checar alguma possibilidade e te retorno.", "4g. com a frase que o dono escolheu");

// ------------------------------------------------- 5. o prompt
const CEREBRO = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
ok(/NÃO PEÇA NOME ANTES DE ESCALAR/.test(CEREBRO) && !/ANTES DE MANDAR, PEGUE O QUE FALTA/.test(CEREBRO), "5. o prompt não manda mais pedir nome antes de escalar");
ok(/NUNCA ofereça de novo os horários que ela já viu/.test(CEREBRO), "5b. nem repetir horário recusado");
ok(/NUNCA diga que "já buscou com prioridade"/.test(CEREBRO), "5c. nem inventar que já fez o que não fez");

console.log(`encaixe-de-urgencia: ${passou} passaram, ${erros.length} falharam`);
if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
