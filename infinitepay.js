/*
 * A conversa com a InfinitePay: cria a cobrança da consulta e confere se foi paga.
 *
 * O contrato veio da documentação oficial, dentro do app (Checkout Integrado ->
 * Documentação). Não de blog nem de plugin de terceiro: duas fontes assim me deram o
 * endereço errado e o nome do campo errado antes de o Dr. Bruno abrir o app.
 *
 *   criar     POST https://api.infinitepay.io/invoices/public/checkout/links
 *             { handle, items: [{ description, quantity, price }], order_nsu, ... }
 *
 *   conferir  POST https://api.infinitepay.io/invoices/public/checkout/payment_check
 *             { handle, order_nsu, transaction_nsu, slug }
 *             -> { success, paid, amount, paid_amount, installments, capture_method }
 *
 * PREÇO EM CENTAVOS, SEMPRE. R$ 550,00 = 55000. Um erro de fator 100 aqui cobra R$ 5,50 ou
 * R$ 55.000,00 de uma família, então o valor entra em centavos e nunca é convertido no meio
 * do caminho.
 *
 * "items" EM INGLÊS. A documentação escrita da InfinitePay mostra "itens" em português na
 * tela ao lado, mas o payload que o próprio app gera escreve "items". O payload gerado
 * ganha, e quem chama manda os dois nomes: custa um campo ignorado e evita depender de qual
 * das duas telas deles está certa.
 *
 * O order_nsu É O slotId. É a única coisa que amarra o dinheiro a uma consulta: sem ele
 * chega um aviso dizendo "entraram R$ 550" e ninguém sabe de quem.
 *
 * POR QUE O fetch É INJETÁVEL. A máquina onde este código foi escrito não alcança
 * infinitepay.io (bloqueio de rede do ambiente), então a bateria precisa exercitar a
 * montagem da requisição e a leitura da resposta sem rede nenhuma. Em produção o padrão é
 * o fetch do Node.
 *
 * NADA AQUI PODE DERRUBAR UM AGENDAMENTO. Toda função devolve { ok: false, motivo } em vez
 * de estourar. Se a InfinitePay estiver fora do ar, a família continua com o horário
 * separado e a Carla volta a mandar a chave Pix na mão: perder a cobrança automática é
 * chato, perder a consulta é prejuízo.
 */

const BASE = "https://api.infinitepay.io/invoices/public/checkout";
const TEMPO_LIMITE_MS = 12000;

function handleConfigurado(env = process.env) {
  return String(env.INFINITEPAY_HANDLE || "").trim().replace(/^\$/, "");
}

// Sem handle configurado, o módulo inteiro fica desligado e quem chama segue pelo caminho
// antigo. É o mesmo princípio das outras portas: melhor inerte do que meio ligado.
function estaLigado(env = process.env) {
  return handleConfigurado(env) !== "";
}

async function pedir(caminho, corpo, { fetchFn = fetch } = {}) {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  try {
    const resposta = await fetchFn(`${BASE}/${caminho}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(corpo),
      signal: controle.signal,
    });
    const texto = await resposta.text();
    let dados = null;
    try { dados = JSON.parse(texto); } catch { /* deixa null: o texto cru vai no motivo */ }
    if (!resposta.ok) {
      return { ok: false, motivo: `InfinitePay respondeu ${resposta.status}: ${texto.slice(0, 300)}` };
    }
    if (!dados) return { ok: false, motivo: `Resposta que não é JSON: ${texto.slice(0, 300)}` };
    return { ok: true, dados };
  } catch (erro) {
    const motivo = erro && erro.name === "AbortError"
      ? `InfinitePay não respondeu em ${TEMPO_LIMITE_MS / 1000}s`
      : `Não consegui falar com a InfinitePay: ${erro && erro.message}`;
    return { ok: false, motivo };
  } finally {
    clearTimeout(relogio);
  }
}

// A resposta da criação não está documentada campo a campo, então procuro o link em todos
// os lugares plausíveis em vez de apostar num. O slug é o código no fim da URL
// (invoice.infinitepay.io/brunoffsoares/Z8oIyXH5hu -> Z8oIyXH5hu) e é o que o
// payment_check pede depois.
function acharUrl(dados) {
  const candidatos = [
    dados && dados.url,
    dados && dados.link,
    dados && dados.payment_url,
    dados && dados.data && dados.data.url,
    dados && dados.data && dados.data.link,
  ];
  return candidatos.find((u) => typeof u === "string" && u.startsWith("http")) || null;
}

function slugDaUrl(url) {
  if (!url) return null;
  const partes = String(url).split("?")[0].split("/").filter(Boolean);
  return partes.length ? partes[partes.length - 1] : null;
}

// valorCentavos: 55000 para R$ 550,00
// orderNsu: o slotId do horário
async function criarCobranca({ valorCentavos, descricao, orderNsu, redirectUrl = null, webhookUrl = null, env = process.env, fetchFn = fetch }) {
  const handle = handleConfigurado(env);
  if (!handle) return { ok: false, motivo: "INFINITEPAY_HANDLE não está configurado." };
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) {
    return { ok: false, motivo: `Valor inválido: ${valorCentavos}. Tem que ser inteiro em centavos.` };
  }
  if (!orderNsu) return { ok: false, motivo: "Sem order_nsu não dá pra saber de qual consulta é o pagamento." };

  const itens = [{ description: String(descricao || "Consulta"), quantity: 1, price: valorCentavos }];
  const corpo = { handle, order_nsu: String(orderNsu), items: itens, itens };
  if (redirectUrl) corpo.redirect_url = redirectUrl;
  if (webhookUrl) corpo.webhook_url = webhookUrl;

  const r = await pedir("links", corpo, { fetchFn });
  if (!r.ok) return r;

  const url = acharUrl(r.dados);
  if (!url) return { ok: false, motivo: `Criou, mas não achei o link na resposta: ${JSON.stringify(r.dados).slice(0, 300)}` };

  return { ok: true, url, slug: slugDaUrl(url), valorCentavos };
}

// transactionNsu só existe depois de alguém pagar e voltar pelo redirect, então é opcional:
// mandamos o que temos. handle + order_nsu + slug é o que dá pra ter sempre.
async function conferirPagamento({ orderNsu, slug = null, transactionNsu = null, env = process.env, fetchFn = fetch }) {
  const handle = handleConfigurado(env);
  if (!handle) return { ok: false, motivo: "INFINITEPAY_HANDLE não está configurado." };
  if (!orderNsu) return { ok: false, motivo: "Sem order_nsu não dá pra conferir." };

  const corpo = { handle, order_nsu: String(orderNsu) };
  if (slug) corpo.slug = slug;
  if (transactionNsu) corpo.transaction_nsu = transactionNsu;

  const r = await pedir("payment_check", corpo, { fetchFn });
  if (!r.ok) return r;

  const d = r.dados || {};
  // success=false não é erro de rede: é a InfinitePay dizendo que não achou. Tratamos como
  // "ainda não pagou", nunca como "pagou".
  const pago = d.success === true && d.paid === true;
  return {
    ok: true,
    pago,
    valorCentavos: Number.isFinite(Number(d.paid_amount)) ? Number(d.paid_amount) : null,
    esperadoCentavos: Number.isFinite(Number(d.amount)) ? Number(d.amount) : null,
    parcelas: Number.isFinite(Number(d.installments)) ? Number(d.installments) : null,
    forma: d.capture_method || null,
  };
}

module.exports = { criarCobranca, conferirPagamento, estaLigado, handleConfigurado, slugDaUrl, BASE };
