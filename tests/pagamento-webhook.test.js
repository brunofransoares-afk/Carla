/*
 * Bateria da porta que recebe o aviso de pagamento da InfinitePay.
 *
 * POR QUE ESTA PORTA EXISTE. Eu tinha apostado no payment_check: a Carla perguntaria em vez
 * de esperar, e o servidor não precisaria receber nada de fora. Testamos com um pagamento de
 * verdade — o Dr. Bruno pagou R$ 1,00 numa cobrança criada pela API — e o payment_check
 * devolveu {"success":false} pra TODAS as combinações que temos em mãos:
 *
 *   só order_nsu                          -> success:false
 *   order_nsu + hexadecimal do fim do lenc -> success:false
 *   order_nsu + lenc inteiro como slug     -> success:false
 *   só slug=hexadecimal / só slug=lenc     -> success:false
 *   order_nsu + transaction_nsu=hex        -> success:false
 *
 * Ele confirma quem VOLTOU pelo redirect, com o transaction_nsu que só existe depois de a
 * pessoa clicar em "Continuar". Não descobre quem pagou. Sobrou o aviso.
 *
 * Roda com:  node tests/pagamento-webhook.test.js
 */
"use strict";
const path = require("path");
const PW = require(path.join(__dirname, "..", "pagamento-webhook.js"));

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const SEGREDO = "abc123segredo";
const env = { INFINITEPAY_WEBHOOK_SECRET: SEGREDO };
const url = (s) => `/webhook/infinitepay/${s}`;

// ------------------------------------------------- 1. inerte sem configuração
// Uma porta que aceita qualquer coisa enquanto ninguém configurou marcaria consulta como
// paga a pedido de quem chegasse primeiro.
{
  const r = PW.decidir({ url: url(SEGREDO), method: "POST", env: {} });
  eq(r.tipo, "recusar", "1. sem segredo configurado, recusa");
  eq(r.status, 503, "1. e diz que não está configurado");
}

// ------------------------------------------------- 2. o endereço tem que bater
{
  eq(PW.decidir({ url: url(SEGREDO), method: "POST", env }).tipo, "pagamento", "2. segredo certo entra");
  eq(PW.decidir({ url: url("outro"), method: "POST", env }).status, 403, "2. segredo errado é 403");
  eq(PW.decidir({ url: url(""), method: "POST", env }).status, 403, "2. sem segredo nenhum é 403");
  eq(PW.decidir({ url: url(SEGREDO.slice(0, -1)), method: "POST", env }).status, 403, "2. segredo quase certo é 403");
  eq(PW.decidir({ url: url(SEGREDO + "x"), method: "POST", env }).status, 403, "2. segredo com sobra é 403");
  eq(PW.decidir({ url: url(SEGREDO) + "/", method: "POST", env }).tipo, "pagamento", "2. barra no fim não atrapalha");
  eq(PW.decidir({ url: url(SEGREDO) + "?x=1", method: "POST", env }).tipo, "pagamento", "2. parâmetro na URL não atrapalha");
}

// ------------------------------------------------- 3. nada mais passa por aqui
{
  for (const u of ["/", "/api/dados", "/interno/portal-liberado", "/webhook/outro/coisa"]) {
    eq(PW.decidir({ url: u, method: "POST", env }).tipo, "passar", `3. ${u} segue o fluxo normal do painel`);
  }
  eq(PW.decidir({ url: url(SEGREDO), method: "GET", env }).status, 405, "3. GET nesta porta é 405");
}

// ------------------------------------------------- 4. o aviso que serve
{
  const r = PW.lerAviso({
    order_nsu: "2026-08-06T09:30", paid_amount: 55000, amount: 55000,
    capture_method: "pix", transaction_nsu: "uuid-1", receipt_url: "https://comprovante",
  });
  eq(r.ok, true, "4. aviso completo é aceito");
  eq(r.slotId, "2026-08-06T09:30", "4. o order_nsu é o horário da consulta");
  eq(r.pago.valorCentavos, 55000, "4. com o valor que entrou");
  eq(r.pago.forma, "pix", "4. e a forma");
  eq(r.pago.comprovante, "https://comprovante", "4. e o comprovante, pra bater com o extrato");
}

// ------------------------------------------------- 5. aviso torto nunca marca pago
// O erro mais caro possível: dar uma consulta como paga sem ter sido.
{
  const tortos = [
    [{}, "sem nada"],
    [{ paid_amount: 55000 }, "sem order_nsu: não dá pra saber de qual consulta é"],
    [{ order_nsu: "x" }, "sem valor"],
    [{ order_nsu: "x", paid_amount: 0 }, "valor zero"],
    [{ order_nsu: "x", paid_amount: -100 }, "valor negativo"],
    [{ order_nsu: "x", paid_amount: "muito" }, "valor que não é número"],
    [{ order_nsu: "   ", paid_amount: 100 }, "order_nsu só com espaço"],
    [null, "corpo nulo"],
    ["texto", "corpo que não é objeto"],
  ];
  for (const [corpo, nome] of tortos) {
    eq(PW.lerAviso(corpo).ok, false, `5. ${nome} não vira pagamento`);
  }
}

// ------------------------------------------------- 6. o que falta é opcional, o essencial não
{
  const r = PW.lerAviso({ order_nsu: "x", paid_amount: 100 });
  eq(r.ok, true, "6. order_nsu e valor bastam");
  eq(r.pago.forma, null, "6. o resto vem null sem quebrar");
  eq(r.pago.comprovante, null, "6. inclusive o comprovante");
}

// ------------------------------------------------- 7. o caminho até a família existe
// O aviso chega no painel, mas quem tem a conexão do WhatsApp é o bot. Se esse encanamento
// sumir, o pagamento é marcado e a família nunca recebe a confirmação.
{
  const fs = require("fs");
  const painel = fs.readFileSync(path.join(__dirname, "..", "painel-server.js"), "utf8");
  ok(/encaminharAoBot\("\/interno\/pagamento-confirmado"/.test(painel),
    "7. o painel encaminha pro bot depois de marcar pago");

  const bot = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  ok(/req\.url === "\/interno\/pagamento-confirmado"/.test(bot),
    "7. e o bot escuta esse caminho");
  ok(/async function avisarPagamentoConfirmado\(slotId\)/.test(bot),
    "7. com a função que manda a mensagem");
  ok(/if \(a\.pagamentoAvisadoEm\) return \{ ok: true, jaAvisado: true \};/.test(bot),
    "7. e a trava contra mandar duas vezes, porque a InfinitePay reenvia o aviso");
  ok(/está confirmada para/.test(bot),
    "7. a mensagem confirma a consulta, que é o único momento em que essa palavra vale");
}

console.log(erros.map((e) => "  FALHA " + e).join("\n"));
console.log(`pagamento-webhook: ${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
