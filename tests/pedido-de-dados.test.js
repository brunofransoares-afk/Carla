/*
 * Bateria: o e-mail e a data de nascimento são pedidos logo depois de o horário ficar
 * separado, e não só quando o pagamento é confirmado.
 *
 * ESTES DOIS DADOS JÁ MUDARAM DE LUGAR DUAS VEZES, e as duas por motivo real. É por isso que
 * esta bateria existe: pra terceira mudança não desfazer a primeira sem alguém perceber.
 *
 *   1. Iam na mensagem da RESERVA, que ficava com cinco assuntos (horário, prazo, endereço,
 *      Pix, cartão). A família respondia um e esquecia o resto, quase sempre o e-mail.
 *   2. Foram pra mensagem de PAGAMENTO CONFIRMADO, onde ela acabou de pagar e está satisfeita.
 *      Só que ali chegam tarde: quem paga três dias depois só é perguntado três dias depois, e
 *      quem nunca paga nunca é perguntado. O dono, em 01/10/2026: "isso tem que ser perguntado
 *      depois que ela fechou a consulta, já escolheu um horário... mas não precisa ter feito o
 *      pagamento".
 *   3. Agora são os DOIS momentos, e nenhum deles empilha: o pedido sai SOZINHO logo depois da
 *      reserva, e a confirmação pede o que AINDA faltar.
 *
 * O que este arquivo guarda, então: que o pedido é mensagem própria (não emendada), que ele
 * não pergunta o que a família já mandou, e que o texto é um só nos dois lugares.
 *
 * Roda com:  node tests/pedido-de-dados.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const P = require("../pedido-de-dados.js");

let passou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const SEM_NADA = { crianca: "Miguel Souza", responsavel: "Ana" };
const SO_EMAIL = { ...SEM_NADA, responsavelEmail: "ana@exemplo.com" };
const SO_DATA = { ...SEM_NADA, criancaDataNascimento: "2020-03-14" };
const COMPLETO = { ...SEM_NADA, responsavelEmail: "ana@exemplo.com", criancaDataNascimento: "2020-03-14" };

// ------------------------------------------------- 1. só pede o que falta
{
  eq(P.oQueFalta(SEM_NADA).join(","), "email,nascimento", "1. sem nada, faltam os dois");
  eq(P.oQueFalta(SO_EMAIL).join(","), "nascimento", "1b. com e-mail, falta só o nascimento");
  eq(P.oQueFalta(SO_DATA).join(","), "email", "1c. com a data, falta só o e-mail");
  eq(P.oQueFalta(COMPLETO).length, 0, "1d. com os dois, não falta nada");
  eq(P.oQueFalta(null).length, 2, "1e. agendamento ausente não derruba");

  eq(P.mensagemDepoisDaReserva(COMPLETO), "",
    "2. quem já mandou os dois NÃO é perguntado de novo: é o que faz a família achar que ninguém leu");
  ok(/seu \*e-mail\* e a data de nascimento de Miguel/.test(P.mensagemDepoisDaReserva(SEM_NADA)),
    "2b. faltando os dois, pede os dois, e a criança pelo primeiro nome");
  ok(!/e-mail/.test(P.mensagemDepoisDaReserva(SO_EMAIL)),
    "2c. quem já deu o e-mail não ouve falar dele de novo");
  ok(!/nascimento/.test(P.mensagemDepoisDaReserva(SO_DATA)),
    "2d. nem quem já deu a data");
}

// ------------------------------------------------- 2. o porquê muda com o que falta
{
  ok(/curva de crescimento de Miguel/.test(P.mensagemDepoisDaReserva(SO_EMAIL)),
    "3. faltando só a data, o motivo é a curva de crescimento");
  ok(/criar o portal de Miguel/.test(P.mensagemDepoisDaReserva(SEM_NADA)),
    "3b. faltando o e-mail, o motivo é o portal, que é o que o e-mail destrava");
  ok(!/curva de crescimento/.test(P.mensagemDepoisDaReserva(SEM_NADA)),
    "3c. e os dois motivos não se misturam numa mensagem só");
}

// ------------------------------------------------- 3. mensagem própria contra trecho emendado
{
  const sozinha = P.mensagemDepoisDaReserva(SEM_NADA);
  const emendado = P.trechoNaConfirmacao(SEM_NADA);
  ok(!/^\n/.test(sozinha), "4. a mensagem de depois da reserva começa por conta própria");
  ok(/^\n\n/.test(emendado), "4b. e o trecho da confirmação começa com as quebras, porque ele é emendado");
  eq(P.trechoNaConfirmacao(COMPLETO), "", "4c. o trecho também some quando não falta nada");
  ok(sozinha.indexOf(P.listaDoQueFalta(SEM_NADA)) > 0 && emendado.indexOf(P.listaDoQueFalta(SEM_NADA)) > 0,
    "4d. e os dois pedem a mesma coisa, do mesmo lugar");

  // Curta de propósito. O defeito de 2026-08 foi um parágrafo com cinco assuntos.
  ok(sozinha.split("\n").filter(Boolean).length <= 2,
    "4e. a mensagem tem duas linhas: o pedido e o motivo, e nada mais");
}

// ------------------------------------------------- 4. o servidor usa os dois, e um texto só
{
  const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  ok(/await pedirDadosDoPortal\(resultado\.acoes, telefone, jid\);/.test(SERVER),
    "5. o pedido sai logo depois da reserva, no mesmo turno");
  const posResposta = SERVER.indexOf("await enviarResposta(sockAtivo, jid, telefone, resultado.resposta");
  const posPedido = SERVER.indexOf("await pedirDadosDoPortal(");
  ok(posResposta > 0 && posPedido > posResposta,
    "5b. e DEPOIS da mensagem da Carla, senão ele atravessa o texto do pagamento");
  // O CAMINHO QUE IMPORTA É A CONVERSA NORMAL. Até 01/10/2026 a chamada só existia na
  // resposta do Dr. Bruno pelo painel, e as duas checagens acima passavam assim mesmo: o
  // dono marcou uma consulta de teste e não recebeu o pedido. Agora a conferência é DENTRO
  // de processarMensagem, depois da resposta dela.
  const conversa = SERVER.slice(SERVER.indexOf("async function processarMensagem("), SERVER.indexOf("async function enviarLembretes("));
  const respostaNaConversa = conversa.indexOf("await enviarResposta(sock, jid, telefone, resultado.resposta");
  const pedidoNaConversa = conversa.indexOf("await pedirDadosDoPortal(resultado.acoes, telefone, jid);");
  ok(respostaNaConversa > 0 && pedidoNaConversa > respostaNaConversa,
    "5b2. na conversa normal, o pedido sai logo depois da mensagem da reserva");
  // A confirmação do pagamento foi retirada inteira em 01/10/2026, horas depois desta
  // mudança, a pedido do dono. O pedido ficou só onde ele já estava: logo depois da reserva.
  // O trechoNaConfirmacao continua existindo e testado, pro dia em que a mensagem voltar.
  ok(!/trechoNaConfirmacao/.test(SERVER),
    "5c. a confirmação do pagamento não existe mais, então o pedido dela saiu junto");
  ok(/chaveIdempotencia: `dados-do-portal:\$\{acao\.slotId\}`/.test(SERVER),
    "5d. uma vez por reserva: um reenvio não pergunta duas vezes a mesma coisa");
  ok(/PedidoDeDados\.mensagemDepoisDaReserva\(a\)/.test(SERVER) && /if \(!texto\) continue;/.test(SERVER),
    "5e. e nada é enviado quando a mensagem vem vazia");
  ok(!/falta\.push\("seu \*e-mail\*"\)/.test(SERVER),
    "5f. a cópia antiga do texto saiu do servidor: duas cópias viram duas frases diferentes");
  ok(/Storage\.acharAgendamentoPorSlot\(acao\.slotId\)/.test(SERVER),
    "5g. o que falta é lido do agendamento GRAVADO, não do que a IA disse ter feito");
}

console.log(`pedido-de-dados: ${passou} passaram, ${erros.length} falharam`);
if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
