// Até quando a família tem pra pagar: até o horário da consulta.
//
// COMO ERA. "Consulta à tarde paga até o meio-dia, de manhã paga na véspera", com a reserva
// VENCENDO sozinha quando o prazo passava. Em 10/09 isso derrubou uma consulta de verdade:
// reservada às 11:47 pra hoje às 14h, o prazo era meio-dia, a família pagou às 11:52, o Dr.
// Bruno não clicou "pago" em 13 minutos, e ao meio-dia a reserva venceu, sumiu da agenda e
// mandou cancelar no SPI e no Google.
//
// COMO É, dito por ele: o pagamento pode ser feito até o horário da consulta. Quem confirma
// é ele, clicando "pago" no painel quando vê o dinheiro, no ritmo dele. A reserva NÃO vence
// sozinha: fica na agenda até a consulta, paga ou não. Pressa e contagem regressiva saíram
// da conversa.
//
// A função continua existindo (e continua validando o horário) pra ferramenta ter UMA fonte
// da frase, e pra ninguém voltar a inventar prazo no prompt.
"use strict";

function validarSlot(slot) {
  if (!slot || !/^\d{4}-\d{2}-\d{2}$/.test(String(slot.date || ""))) {
    throw new TypeError("Data do horário inválida.");
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(slot.time || ""))) {
    throw new TypeError("Hora do horário inválida.");
  }
  const [ano, mes, dia] = slot.date.split("-").map(Number);
  const d = new Date(ano, mes - 1, dia);
  if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) {
    throw new TypeError("Data do horário inválida.");
  }
}

const TEXTO = "até o horário da consulta";

// slot: { date: "AAAA-MM-DD", time: "HH:MM" }; now só existe pela assinatura antiga.
// Devolve { texto, expiraEm: null }: a frase pronta e nenhum vencimento automático.
function prazoDePagamento(slot, now = new Date()) {
  validarSlot(slot);
  if (Number.isNaN(new Date(now).getTime())) throw new TypeError("Data atual inválida.");
  return { agora: false, texto: TEXTO, expiraEm: null };
}

module.exports = { prazoDePagamento, TEXTO };
