"use strict";

// Um link de cartão por VALOR. O link antigo (R$ 550) continua valendo pra consulta de tnd,
// que custa isso. Os outros valores precisam do link configurado no .env; sem ele, a Carla
// oferece Pix e leva o pedido de cartão pro Dr. Bruno gerar o link certo. Nunca manda o
// link de um valor diferente do que a família ouviu.
const LINK_SEMANA_PADRAO =
  "https://link.infinitepay.io/brunoffsoares/VC1DLTMtSQ-n2bxJy5HPf-550,00";

function limpar(valor) {
  const v = String(valor || "").trim();
  if (!v || v.length > 500 || /[\u0000-\u001f\u007f]/.test(v)) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.hostname !== "link.infinitepay.io") return null;
    if (u.username || u.password || u.port || u.hash || u.pathname === "/") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function linkParaCentavos(centavos) {
  const c = Number(centavos);
  if (c === 35000) return limpar(process.env.LINK_PAGAMENTO_URGENCIA);
  if (c === 45000) return limpar(process.env.LINK_PAGAMENTO_PUERICULTURA);
  if (c === 55000) return limpar(process.env.LINK_PAGAMENTO_TND) || limpar(process.env.LINK_PAGAMENTO_SEMANA) || LINK_SEMANA_PADRAO;
  if (c === 60000) return limpar(process.env.LINK_PAGAMENTO_URGENCIA_FIM_DE_SEMANA);
  return null;
}

function formasParaPreco(centavos) {
  const linkCartao = linkParaCentavos(centavos);
  return {
    pix: true,
    cartao: !!linkCartao,
    linkCartao,
    avisoCartao: linkCartao
      ? null
      : "Não existe link de cartão configurado para este valor. Não envie link de outro valor. Ofereça Pix; se a família precisar de cartão, escale para o Dr. Bruno gerar o link correto.",
  };
}

module.exports = { LINK_SEMANA_PADRAO, linkParaCentavos, formasParaPreco };
