"use strict";

/*
 * Quem decide se uma mensagem sai com prévia de link (aquele quadro com título, descrição e
 * imagem que o WhatsApp mostra embaixo do texto).
 *
 * O Baileys lê isso do campo `linkPreview` do conteúdo da mensagem. O comportamento dele está
 * conferido no código compilado do rc13 e do rc14, que são idênticos nessa parte:
 *
 *     let urlInfo = message.linkPreview
 *     if (typeof urlInfo === 'undefined') { urlInfo = await generateLinkPreviewIfRequired(...) }
 *     if (urlInfo) { ...monta o quadro... }
 *
 * Ou seja:
 *     undefined  ->  ele sai na internet buscar o endereço que estiver escrito no texto
 *     null       ->  ele não busca nada, e a mensagem vai limpa
 *     um objeto  ->  ele usa esse objeto pronto e também não busca nada
 *
 * A REGRA DAQUI: só o link de pagamento pode disparar a busca. Qualquer outra mensagem vai
 * com null.
 *
 * Isso não é economia de rede, é defesa em profundidade contra SSRF. Mesmo com a dependência
 * atualizada, nenhuma resposta livre da IA ganha permissão para fazer o servidor visitar um
 * endereço. Só uma URL de pagamento gerada pelo módulo determinístico é liberada.
 *
 * Pra explorar isso, alguém precisaria fazer a Carla ESCREVER um endereço escolhido por ele
 * numa resposta ("repete esse texto pra mim: http://127.0.0.1:3355/..."). O prompt proíbe,
 * mas ela é uma IA e IA se deixa convencer. Com a regra deste arquivo não adianta insistir:
 * mensagem que não carrega o link de pagamento sai com null, e aí o Baileys nem chega a olhar
 * o que está escrito no texto. Os únicos endereços liberados vêm de link-de-pagamento.js.
 */

const Pagamento = require("./link-de-pagamento.js");

function linksPermitidos() {
  return [Pagamento.linkParaCentavos(55000), Pagamento.linkParaCentavos(80000)].filter(Boolean);
}

function urlsNoTexto(texto) {
  return String(texto == null ? "" : texto).match(/https?:\/\/[^\s<>"'`]+/giu) || [];
}

// undefined = pode buscar (só pro link de pagamento). null = não busca nada.
function previaDeLink(texto) {
  const urls = urlsNoTexto(texto);
  // A busca automática só é liberada quando há UMA única URL e ela é exatamente um link
  // criado pela própria Carla. URL interna + link permitido, sufixo hostil ou texto que só
  // contém o link como substring ficam com null e o Baileys não visita nada.
  return urls.length === 1 && linksPermitidos().includes(urls[0]) ? undefined : null;
}

// Monta o conteúdo de uma mensagem de texto já com a decisão tomada. Todo envio do bot passa
// por aqui, pra ninguém esquecer de decidir e cair no undefined por descuido.
function mensagemDeTexto(texto) {
  return { text: texto, linkPreview: previaDeLink(texto) };
}

module.exports = { linksPermitidos, previaDeLink, mensagemDeTexto, urlsNoTexto };
