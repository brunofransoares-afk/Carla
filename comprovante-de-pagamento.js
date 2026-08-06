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
 * SÓ LINK, e isso é deliberado. Comprovante de Pix quase sempre vem como IMAGEM, e imagem já
 * passa em silêncio hoje (o server só lê texto). O que sobrava respondendo era o link, que é o
 * que a InfinitePay gera quando a família paga pelo link do cartão. Frase solta tipo "acabei de
 * pagar" NÃO entra aqui: aquilo é conversa, e conversa a Carla responde.
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

module.exports = { pareceComprovante, HOSTS_CONHECIDOS };
