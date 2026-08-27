"use strict";

// O link antigo tem valor fixo de R$ 550. Um horário de fim de semana custa R$ 800 e não
// pode reutilizá-lo. O link de R$ 800 precisa ser configurado explicitamente; sem ele, a
// Carla oferece Pix e leva um pedido de cartão para o Dr. Bruno, nunca cobra valor errado.
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
  if (Number(centavos) === 55000) {
    return limpar(process.env.LINK_PAGAMENTO_SEMANA) || LINK_SEMANA_PADRAO;
  }
  if (Number(centavos) === 80000) {
    return limpar(process.env.LINK_PAGAMENTO_FIM_DE_SEMANA);
  }
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
      : "Não existe link de cartão configurado para este valor. Não envie o link de R$ 550. Ofereça Pix; se a família precisar de cartão, escale para o Dr. Bruno gerar o link correto.",
  };
}

module.exports = { LINK_SEMANA_PADRAO, linkParaCentavos, formasParaPreco };
