"use strict";

/*
 * Reconhece quando a família mandou um COMPROVANTE DE PAGAMENTO, pra Carla não responder nada.
 *
 * POR QUE O SILÊNCIO É O CERTO AQUI. Quem confirma pagamento é o Dr. Bruno, apertando "Pago"
 * no painel. Esse botão dispara uma mensagem escrita em código (avisarPagamentoConfirmado, em
 * server.js) que confirma a consulta E pede o e-mail e a data de nascimento que ainda faltam.
 *
 * Quando a Carla respondia o comprovante por conta própria, ela dizia que ia "repassar pro Dr.
 * Bruno" e JÁ PEDIA o e-mail e a data de nascimento. Aí o Dr. Bruno apertava o botão e a mesma
 * família recebia o mesmo pedido de novo, dois minutos depois. Aconteceu com o Almir em
 * 06/08/2026, 12:05: ela pediu, o painel pediu de novo.
 *
 * Além do pedido duplicado, o texto dela ficava ruim de propósito nenhum: "recebi, vou repassar
 * e confirmar" soa como desconfiança, como se o comprovante estivesse sob suspeita. Não é papel
 * dela avaliar comprovante. É papel do Dr. Bruno, olhando a conta.
 *
 * ISTO É CÓDIGO, NÃO REGRA DE PROMPT, de propósito. Uma regra escrita no prompt ela contorna
 * quando outra regra puxa pro outro lado, e a semana inteira mostrou isso acontecendo. Aqui a
 * mensagem nem chega na IA.
 *
 * SÃO DOIS CAMINHOS, e eles reconhecem o comprovante por coisas diferentes.
 *
 * 1. PELO LINK (pareceComprovante). É o que a InfinitePay gera quando a família paga pelo
 *    link do cartão. Frase solta tipo "acabei de pagar" NÃO entra aqui: aquilo é conversa, e
 *    conversa a Carla responde.
 *
 * 2. PELA MÍDIA MAIS O CONTEXTO (midiaEhComprovante), acrescentado em 01/10/2026. Comprovante
 *    de Pix quase sempre vem como PRINT, e print não tem texto pra reconhecer. O comentário
 *    antigo aqui dizia que imagem "já passa em silêncio hoje", e tinha deixado de ser verdade:
 *    desde que o servidor passou a pedir "me diga por escrito o que quer que eu observe", toda
 *    imagem virou essa frase. O dono mandou o print: comprovante de Pix do PagBank, e a Carla
 *    respondendo que precisava que ele descrevesse.
 *
 *    NÃO LEMOS A IMAGEM. Lemos o contexto: imagem (ou PDF) chegando de um telefone que tem
 *    consulta SEPARADA E NÃO PAGA é comprovante, e o sistema não precisa de mais nada pra
 *    saber disso. É a mesma ideia determinística do resto: a certeza vem do estado, não de um
 *    palpite sobre o conteúdo. Sem reserva esperando pagamento, a imagem segue o caminho
 *    normal (foto de exame, carteira de vacinação), e ali o pedido de descrever faz sentido.
 */

// O host que o link de pagamento do consultório gera quando a família paga.
const HOSTS_CONHECIDOS = ["recibo.infinitepay.io"];

// Um comprovante quase sempre se anuncia no próprio endereço. Isso pega os bancos e as
// carteiras que a gente não tem como listar um por um.
const HOST_DE_RECIBO = /^(recibo|recibos|comprovante|comprovantes)\./i;
const CAMINHO_DE_RECIBO = /\/(recibo|recibos|comprovante|comprovantes)(\/|$|\?|#)/i;

const URLS = /https?:\/\/[^\s<>"']+/gi;

// Tira o host de uma URL sem usar new URL(): URL malformada que a família digitou não pode
// derrubar o processo, e aqui um erro custaria a mensagem inteira.
function hostDa(url) {
  const semEsquema = String(url).replace(/^https?:\/\//i, "");
  const host = semEsquema.split(/[/?#]/)[0] || "";
  return host.split("@").pop().split(":")[0].toLowerCase();
}

function caminhoDa(url) {
  const semEsquema = String(url).replace(/^https?:\/\//i, "");
  const barra = semEsquema.indexOf("/");
  return barra < 0 ? "/" : semEsquema.slice(barra);
}

function pareceComprovante(texto) {
  const achadas = String(texto == null ? "" : texto).match(URLS);
  if (!achadas) return false;
  return achadas.some((url) => {
    const host = hostDa(url);
    if (!host) return false;
    if (HOSTS_CONHECIDOS.includes(host)) return true;
    if (HOST_DE_RECIBO.test(host)) return true;
    return CAMINHO_DE_RECIBO.test(caminhoDa(url));
  });
}

// Este telefone tem alguma consulta separada esperando pagamento? É o contexto que
// transforma uma imagem qualquer em comprovante. Recebe a lista inteira de agendamentos em
// vez de ir buscar: assim a regra roda em teste sem banco, e quem chama já tem a lista.
function reservaEsperandoPagamento(agendamentos, telefone) {
  if (!Array.isArray(agendamentos) || !telefone) return false;
  return agendamentos.some((a) => a && a.telefone === telefone && !a.pago);
}

// A decisão, com os dois sinais separados de propósito: um diz O QUE chegou, o outro diz DE
// QUEM. Nenhum dos dois sozinho basta, e é por isso que a função existe em vez de um "&&"
// solto no meio do servidor: é aqui que alguém vem ler por que uma foto passou em silêncio.
function midiaEhComprovante({ ehImagemOuDocumento = false, esperandoPagamento = false } = {}) {
  return ehImagemOuDocumento === true && esperandoPagamento === true;
}

module.exports = { pareceComprovante, reservaEsperandoPagamento, midiaEhComprovante, HOSTS_CONHECIDOS };
