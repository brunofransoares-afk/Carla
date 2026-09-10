"use strict";

// Um link de cartão por VALOR. Os três links do InfinitePay vivem aqui como padrão (o Dr.
// Bruno gerou os de R$ 450 e R$ 350 em 10/09/2026; o de R$ 550 é o antigo); o .env pode
// trocar qualquer um. Só a urgência de fim de semana (R$ 600) ainda depende do .env: sem
// ele, a Carla oferece Pix e leva o pedido de cartão pro Dr. Bruno gerar o link certo.
// Nunca manda o link de um valor diferente do que a família ouviu.
const LINK_SEMANA_PADRAO =
  "https://link.infinitepay.io/brunoffsoares/VC1DLTMtSQ-n2bxJy5HPf-550,00";
const LINK_PUERICULTURA_PADRAO =
  "https://link.infinitepay.io/brunoffsoares/VC1D-biYWpCgYs2-450,00";
const LINK_URGENCIA_PADRAO =
  "https://link.infinitepay.io/brunoffsoares/VC1D-zrz07w86oA-350,00";

// PARCELAMENTO. Só a consulta de R$ 550 é dividida em até 3x sem juros, e só se a família
// perguntar. Puericultura e urgência são à vista: o link permite que a família parcele no
// cartão dela, mas aí as taxas do parcelamento ficam por conta dela, não do consultório.
const PARCELAS_SEM_JUROS = { 55000: 3 };

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
  if (c === 35000) return limpar(process.env.LINK_PAGAMENTO_URGENCIA) || LINK_URGENCIA_PADRAO;
  if (c === 45000) return limpar(process.env.LINK_PAGAMENTO_PUERICULTURA) || LINK_PUERICULTURA_PADRAO;
  if (c === 55000) return limpar(process.env.LINK_PAGAMENTO_TND) || limpar(process.env.LINK_PAGAMENTO_SEMANA) || LINK_SEMANA_PADRAO;
  if (c === 60000) return limpar(process.env.LINK_PAGAMENTO_URGENCIA_FIM_DE_SEMANA);
  return null;
}

function parcelasSemJuros(centavos) {
  return PARCELAS_SEM_JUROS[Number(centavos)] || 1;
}

function formasParaPreco(centavos) {
  const linkCartao = linkParaCentavos(centavos);
  const parcelas = parcelasSemJuros(centavos);
  return {
    pix: true,
    cartao: !!linkCartao,
    linkCartao,
    parcelasSemJuros: parcelas,
    parcelamento: parcelas > 1
      ? `Este valor pode ser dividido em até ${parcelas}x sem juros no cartão, se a família perguntar.`
      : "Este valor é à vista. Não ofereça parcelamento. Se a família perguntar se pode dividir, diga que o link é à vista; se ela quiser parcelar no cartão dela, o link permite, mas as taxas do parcelamento ficam por conta dela.",
    avisoCartao: linkCartao
      ? null
      : "Não existe link de cartão configurado para este valor. Não envie link de outro valor. Ofereça Pix; se a família precisar de cartão, escale para o Dr. Bruno gerar o link correto.",
  };
}

module.exports = { LINK_SEMANA_PADRAO, LINK_PUERICULTURA_PADRAO, LINK_URGENCIA_PADRAO, PARCELAS_SEM_JUROS, linkParaCentavos, parcelasSemJuros, formasParaPreco };
