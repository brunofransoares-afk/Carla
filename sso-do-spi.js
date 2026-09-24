// LOGIN ÚNICO: o SPI abre o painel da Carla sem senha.
//
// O painel vive em outro domínio, então "entrar no SPI e já estar logado na Carla" só existe
// se o painel aceitar uma credencial vinda de lá. A credencial não pode ser a senha do painel:
// tudo que chega ao navegador é público. O SPI assina um TICKET curto com um segredo que só
// existe nos dois servidores, e o painel confere a assinatura e abre a sessão DELE.
//
// A outra metade já está escrita no SPI (Edge Function "carla-sso"). Este módulo é o contrato
// dela, do lado de cá, escrito como código puro: recebe strings, devolve decisão, não toca em
// rede nem em disco. É o que permite testar cada recusa sem subir servidor.
//
// ticket  = base64url(payload) + "." + base64url(hmac_sha256(segredo, base64url(payload)))
// payload = JSON { sub, email, iat, exp, nonce, dest }
"use strict";

const crypto = require("crypto");

// Toda recusa devolve o mesmo formato. O motivo NUNCA vai pro navegador: ele existe pro log,
// pra investigar um SSO que parou sem precisar adivinhar qual das checagens falhou.
function recusar(motivo) {
  return { ok: false, motivo };
}

// Comparação em tempo constante que não vaza o tamanho: o sha256 dos dois lados tem sempre
// 32 bytes, então timingSafeEqual nunca recebe comprimentos diferentes. Mesma ideia da
// comparação de senha do painel.
function assinaturaConfere(recebida, esperada) {
  const a = crypto.createHash("sha256").update(String(recebida || "")).digest();
  const b = crypto.createHash("sha256").update(String(esperada || "")).digest();
  return crypto.timingSafeEqual(a, b);
}

// Pra onde o painel pode mandar depois de abrir a sessão. Só caminho do próprio painel:
// sem isso, um ticket com dest="https://site-de-golpe" transformaria o SSO num redirecionador
// aberto, e o link sairia do domínio do consultório parecendo legítimo.
//
// "//outro.site" e "/\\outro.site" são endereços de outro host escritos como caminho, e o
// navegador os segue: por isso a regra é começar com uma barra e NÃO ter a segunda.
function caminhoInternoSeguro(dest) {
  const bruto = String(dest == null ? "" : dest);
  if (!bruto.startsWith("/")) return "/";
  if (bruto.startsWith("//") || bruto.startsWith("/\\")) return "/";
  if (/[\x00-\x1f\x7f]/.test(bruto)) return "/";
  return bruto.slice(0, 300);
}

// O nonce impede que um ticket vazado (histórico do navegador, print, log de proxy) volte a
// valer dentro da janela dele. Guarda até o vencimento e joga fora o resto.
//
// Vive em memória de propósito: o painel é um processo só, e reiniciar o painel já encerra
// todas as sessões. A brecha que sobra é reiniciar o painel dentro dos segundos de validade
// de um ticket que alguém tenha copiado. Em troca, um login não escreve em disco.
function criarNonces({ agora = () => Date.now(), maximo = 500 } = {}) {
  const vistos = new Map();

  function limpar() {
    const instante = agora();
    for (const [nonce, validade] of vistos) {
      if (validade <= instante) vistos.delete(nonce);
    }
    while (vistos.size > maximo) vistos.delete(vistos.keys().next().value);
  }

  return {
    jaUsado(nonce) {
      limpar();
      return vistos.has(String(nonce || ""));
    },
    guardar(nonce, expEpochSegundos) {
      vistos.set(String(nonce || ""), Number(expEpochSegundos) * 1000);
      // A limpeza vem DEPOIS de inserir: antes, o teto valia pra lista de um item atrás e
      // ela terminava sempre com um a mais do que o máximo.
      limpar();
    },
    tamanho: () => vistos.size,
  };
}

// A ORDEM DAS CHECAGENS IMPORTA. A assinatura vem primeiro: antes dela o payload é texto de
// desconhecido, e nada que ele diga (exp, nonce, dest) merece confiança. Só depois de provar
// que o SPI assinou é que o conteúdo passa a valer.
function verificarTicket(ticket, segredo, { agora = new Date(), nonces = null } = {}) {
  if (!segredo) return recusar("CARLA_SSO_SECRET não configurado.");
  const bruto = String(ticket == null ? "" : ticket);
  if (!bruto) return recusar("Ticket vazio.");
  if (bruto.length > 4000) return recusar("Ticket longo demais.");

  const partes = bruto.split(".");
  if (partes.length !== 2) return recusar("Ticket malformado.");
  const [corpo, assinatura] = partes;
  if (!corpo || !assinatura) return recusar("Ticket malformado.");

  const esperada = crypto.createHmac("sha256", segredo).update(corpo).digest("base64url");
  if (!assinaturaConfere(assinatura, esperada)) return recusar("Assinatura inválida.");

  let payload;
  try {
    payload = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
  } catch {
    return recusar("Payload ilegível.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return recusar("Payload inválido.");

  const exp = Number(payload.exp);
  if (!Number.isFinite(exp)) return recusar("Ticket sem vencimento.");
  const agoraEpoch = Math.floor(agora.getTime() / 1000);
  if (exp <= agoraEpoch) return recusar("Ticket vencido.");
  // Um ticket assinado com validade de um ano seria uma senha permanente na barra de
  // endereço. A janela curta é o que faz o vazamento dele deixar de importar depressa.
  if (exp - agoraEpoch > MAX_VALIDADE_SEGUNDOS) return recusar("Validade longa demais.");

  const nonce = String(payload.nonce || "");
  if (!nonce) return recusar("Ticket sem nonce.");
  if (nonces && nonces.jaUsado(nonce)) return recusar("Ticket já usado.");
  if (nonces) nonces.guardar(nonce, exp);

  return {
    ok: true,
    email: typeof payload.email === "string" ? payload.email.slice(0, 200) : null,
    sub: typeof payload.sub === "string" ? payload.sub.slice(0, 100) : null,
    nonce,
    exp,
    destino: caminhoInternoSeguro(payload.dest),
  };
}

// Teto de validade aceito, independente do que o ticket diga. O SPI usa 60 segundos por
// padrão; cinco minutos deixa folga pra relógio fora de hora sem virar credencial durável.
const MAX_VALIDADE_SEGUNDOS = 300;

module.exports = { verificarTicket, caminhoInternoSeguro, criarNonces, MAX_VALIDADE_SEGUNDOS };
