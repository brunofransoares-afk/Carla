/*
 * Bateria: o Dr. Bruno escreve pelo celular, a Carla para naquela conversa.
 *
 * O dono (2026-10-01): "a Carla está lá conversando com um paciente e eu vejo que ela acabou
 * de fazer uma caca. Ao invés de abrir o painel e dar silenciar, se eu vou lá e respondo por
 * escrito, qualquer coisa, ela automaticamente silencia esse paciente. E depois, se eu quiser
 * voltar ao atendimento automático, eu retorno no painel."
 *
 * O perigo é confundir as duas vozes do mesmo número: o que a Carla manda também volta como
 * "enviado por mim". Se o eco dela pausasse a conversa, ela se calaria sozinha a cada resposta.
 *
 * Roda com:  node tests/pausa-pelo-celular.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const P = require("../pausa-pelo-celular.js");
const { criarCaixaDeSaida } = require("../caixa-de-saida.js");

let passou = 0;
const erros = [];
function ok(cond, nome) { if (typeof nome !== "string") throw new Error("ok(cond, nome)"); if (cond) passou++; else erros.push(nome); }

const AGORA = Date.parse("2026-10-01T15:00:00Z");
const base = (extra = {}) => ({
  fromMe: true, tipoDoLote: "notify", sistema: false, id: "DELE1",
  timestamp: Math.floor(AGORA / 1000) - 5, telefone: "+5531990001234", telefoneDoDoutor: "+5531988887777",
  registro: P.criarRegistroDeEnvios(() => AGORA), agora: AGORA, ...extra,
});

// ------------------------------------------------- 1. o que é ele
ok(P.ehMensagemDoDoutor(base()), "1. ele escreveu pelo celular agora: é ele");
ok(P.ehMensagemDoDoutor(base({ timestamp: { low: Math.floor(AGORA / 1000) - 5 } })), "1b. timestamp no formato Long do WhatsApp também");

// ------------------------------------------------- 2. o que NÃO é ele
ok(!P.ehMensagemDoDoutor(base({ fromMe: false })), "2. mensagem da família não pausa nada");
ok(!P.ehMensagemDoDoutor(base({ tipoDoLote: "append" })), "2b. eco do que a Carla mandou deste aparelho chega como append: não é ele");
{
  const registro = P.criarRegistroDeEnvios(() => AGORA);
  registro.registrar("DA_CARLA");
  ok(!P.ehMensagemDoDoutor(base({ id: "DA_CARLA", registro })), "2c. id de mensagem que a Carla enviou: não é ele, mesmo chegando como notify");
}
ok(!P.ehMensagemDoDoutor(base({ sistema: true })), "2d. reação e recado de sistema não contam");
ok(!P.ehMensagemDoDoutor(base({ timestamp: Math.floor(AGORA / 1000) - 3600 })), "2e. mensagem de uma hora atrás (sincronização ao reconectar) não pausa agora");
ok(!P.ehMensagemDoDoutor(base({ telefone: "+5531988887777" })), "2f. a conversa com o próprio número dele (onde chegam os avisos) não conta");

// ------------------------------------------------- 3. o registro dos envios esquece com o tempo
{
  let relogio = AGORA;
  const r = P.criarRegistroDeEnvios(() => relogio);
  r.registrar("X");
  ok(r.foiDaCarla("X") && !r.foiDaCarla("Y") && !r.foiDaCarla(null), "3. lembra o que a Carla enviou, e só isso");
  relogio += P.VALIDADE_IDS_MS + 1000;
  ok(!r.foiDaCarla("X"), "3b. e esquece depois de um tempo, pra não crescer sem fim");
}

// ------------------------------------------------- 4. a caixa de saída registra cada envio dela
(async () => {
  const registrados = [];
  const storage = {
    marcarMensagemPendenteEnviada: () => null, removerMensagemPendente: () => {}, marcarFalhaMensagemPendente: () => {},
    listarMensagensPendentes: () => [],
  };
  const caixa = criarCaixaDeSaida({ storage, prepararMensagem: (t) => ({ text: t }), aplicarEfeito: () => {}, logger: { log() {}, error() {} }, aoEnviar: (id) => registrados.push(id) });
  await caixa.tentarEnviar({ sendMessage: async () => ({ key: { id: "ENVIO123" } }) }, { id: "p1", telefone: "+1", jid: "1@s", texto: "oi" });
  ok(registrados[0] === "ENVIO123", "4. todo envio da Carla tem o id registrado");
  let quebrou = false;
  const caixa2 = criarCaixaDeSaida({ storage, prepararMensagem: (t) => ({ text: t }), aplicarEfeito: () => {}, logger: { log() {}, error() {} }, aoEnviar: () => { throw new Error("x"); } });
  try { await caixa2.tentarEnviar({ sendMessage: async () => ({ key: { id: "Z" } }) }, { id: "p2", telefone: "+1", jid: "1@s", texto: "oi" }); } catch { quebrou = true; }
  ok(!quebrou, "4b. erro no registro nunca derruba o envio");

  // ------------------------------------------------- 5. a pausa, executada de verdade
  const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const ini = SERVER.indexOf("function pausarPelaMensagemDoDoutor(");
  const fonte = SERVER.slice(ini, SERVER.indexOf("\n}\n", ini) + 3);
  let gravada = null; const eventos = [];
  const Storage = { obterSessao: () => ({ historico: [{ role: "user", content: "oi" }] }), salvarSessao: (_t, s) => { gravada = s; } };
  const Eventos = { registrar: (...a) => eventos.push(a), trecho: (t) => t };
  const pausar = new Function("Storage", "Eventos", "normalizarSessao", "console", fonte + "\nreturn pausarPelaMensagemDoDoutor;")(
    Storage, Eventos, (_t, s) => ({ historico: [], ...s }), { log() {} });
  pausar("+5531990001234", "Olá, aqui é o Dr. Bruno");
  ok(gravada && gravada.aguardandoHumano === true && gravada.pausadaPeloDoutor === true,
    "5. a conversa fica pausada pelo doutor: só o Retomar do painel desfaz");
  ok(gravada.historico.slice(-1)[0].content === "Olá, aqui é o Dr. Bruno" && gravada.historico.slice(-1)[0].role === "assistant",
    "5b. o que ele escreveu entra no histórico como fala do consultório, pra Carla saber quando voltar");
  ok(eventos.some((e) => e[0] === "mensagem_manual" && e[2].origem === "celular"), "5c. e aparece na linha do tempo da ficha");

  // ------------------------------------------------- 6. no servidor
  const chegada = SERVER.slice(SERVER.indexOf("      if (msg.key.fromMe) {"), SERVER.indexOf("      if (sistema) return;"));
  ok(/PausaPeloCelular\.ehMensagemDoDoutor\(/.test(chegada) && /pausarPelaMensagemDoDoutor\(telefone, textoDele\)/.test(chegada),
    "6. mensagem dele na chegada vira pausa");
  ok(chegada.indexOf("doutorEscreveuEm.set(") < chegada.indexOf("filaMensagens.enfileirar("), "6b. a marca de 'ele escreveu' vem antes da fila, pra resposta em curso enxergar");
  ok(/registro: registroDeEnviosDaCarla/.test(chegada) && /aoEnviar: \(id\) => registroDeEnviosDaCarla\.registrar\(id\)/.test(SERVER),
    "6c. com o registro dos envios da Carla ligado nas duas pontas");
  const turno = SERVER.slice(SERVER.indexOf("async function processarMensagem("), SERVER.indexOf("async function enviarLembretes("));
  const pChecagem = turno.indexOf("const doutorEscreveuNoMeio = (doutorEscreveuEm.get(telefone) || 0) >= inicioDoTurno;");
  const pSai = turno.indexOf("if (doutorEscreveuNoMeio) return;");
  const pEnvio = turno.indexOf("await enviarResposta(sock, jid, telefone, resultado.resposta");
  ok(pChecagem > 0 && pSai > pChecagem && pEnvio > pSai, "6d. a resposta que a Carla montava enquanto ele digitava não sai");
  ok(/if \(type !== "notify"\) return;/.test(SERVER), "6e. lote que não é notify (o eco dela) nem chega aqui");

  console.log(`pausa-pelo-celular: ${passou} passaram, ${erros.length} falharam`);
  if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
