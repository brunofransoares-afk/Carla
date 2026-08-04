/*
 * A PORTA DE MÁQUINA do pagamento: como a InfinitePay avisa a Carla que o dinheiro caiu.
 *
 * Mesma ideia do painel-webhook.js: quem decide se entra é um módulo puro, testável sem
 * abrir porta nenhuma. Aqui só entra (url, método, corpo, ambiente) e sai a decisão.
 *
 * O SEGREDO VAI NA URL, e isso é escolha, não descuido. A InfinitePay não assina o webhook
 * (não manda HMAC nem cabeçalho de autenticação), então não existe o que conferir no
 * cabeçalho. O que sobra é um endereço que só nós dois conhecemos:
 *
 *   POST /webhook/infinitepay/<segredo>
 *
 * O endereço é registrado por chamada, quando o link é criado, então nunca aparece em
 * lugar público. Se um dia ela passar a assinar, a conferência muda pra assinatura e o
 * segredo na URL sai.
 *
 * INERTE SEM CONFIGURAÇÃO. Sem INFINITEPAY_WEBHOOK_SECRET no ambiente, a porta recusa
 * tudo. É de propósito: uma porta que aceita qualquer coisa enquanto ninguém configurou
 * marcaria consulta como paga a pedido de quem chegasse primeiro.
 *
 * O QUE CHEGA. O corpo tem os campos que a InfinitePay manda quando o pagamento entra:
 *
 *   order_nsu       o número do pedido que NÓS mandamos ao criar o link. É o slotId do
 *                   horário, e é a única coisa que amarra o dinheiro a uma consulta.
 *   paid_amount     quanto entrou, em centavos.
 *   amount          quanto era pra entrar, em centavos.
 *   transaction_nsu identificador da transação, guardado pra conferência posterior.
 *   receipt_url     o comprovante.
 *   capture_method  pix ou cartão.
 *
 * NÃO RECUSAMOS POR VALOR DIFERENTE. Pagou menos do que devia é problema de verdade, mas
 * ignorar o aviso não resolve: o dinheiro entrou do mesmo jeito e ninguém ficaria sabendo.
 * Então marca, guarda quanto entrou, e quem confere é o Dr. Bruno olhando o painel.
 */

function recusar(status, motivo) {
  return { tipo: "recusar", status, corpo: { ok: false, motivo } };
}

// Compara sem vazar por tempo. O segredo é curto e vem por rede; não custa nada fazer
// certo, e comparar com === entrega o tamanho e o prefixo pra quem estiver medindo.
function igualSemVazar(a, b) {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

const PREFIXO = "/webhook/infinitepay/";

// Devolve:
//   { tipo: "passar" }                        não é esta porta, segue o fluxo normal do painel
//   { tipo: "recusar", status, corpo }        é esta porta, mas não entra
//   { tipo: "pagamento", segredoOk: true }    é esta porta e o endereço confere: leia o corpo
function decidir({ url = "", method = "", env = {} } = {}) {
  const caminho = String(url).split("?")[0];
  if (!caminho.startsWith(PREFIXO)) return { tipo: "passar" };

  if (String(method).toUpperCase() !== "POST") {
    return recusar(405, "Esta porta só aceita POST.");
  }

  const configurado = String(env.INFINITEPAY_WEBHOOK_SECRET || "").trim();
  if (!configurado) {
    return recusar(503, "Aviso de pagamento não está configurado aqui (falta INFINITEPAY_WEBHOOK_SECRET).");
  }

  const recebido = caminho.slice(PREFIXO.length).replace(/\/+$/, "");
  if (!recebido || !igualSemVazar(recebido, configurado)) {
    return recusar(403, "Endereço de aviso não confere.");
  }

  return { tipo: "pagamento" };
}

// Lê o corpo que chegou e diz o que fazer com ele. Separado de decidir() porque a
// autorização é do endereço e isto é do conteúdo: são duas perguntas diferentes.
//
// Devolve { ok: true, slotId, pago } ou { ok: false, motivo }.
function lerAviso(corpo) {
  const c = corpo && typeof corpo === "object" ? corpo : {};
  const slotId = String(c.order_nsu || "").trim();
  if (!slotId) return { ok: false, motivo: "Aviso sem order_nsu: não dá pra saber de qual consulta é." };

  const centavos = Number(c.paid_amount);
  if (!Number.isFinite(centavos) || centavos <= 0) {
    return { ok: false, motivo: "Aviso sem valor pago: não trata como pagamento." };
  }

  return {
    ok: true,
    slotId,
    pago: {
      valorCentavos: centavos,
      esperadoCentavos: Number.isFinite(Number(c.amount)) ? Number(c.amount) : null,
      forma: c.capture_method || null,
      transacao: c.transaction_nsu || null,
      comprovante: c.receipt_url || null,
    },
  };
}

module.exports = { decidir, lerAviso, PREFIXO };
