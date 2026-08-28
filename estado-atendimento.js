"use strict";

const crypto = require("crypto");

const ETAPAS = Object.freeze({
  INICIO: "inicio",
  HORARIOS_OFERECIDOS: "horarios_oferecidos",
  PRECO_INFORMADO: "preco_informado",
  AGUARDANDO_PAGAMENTO: "aguardando_pagamento",
  PAGO: "pago",
});

const JANELA_CANCELAMENTO_MS = 30 * 60 * 1000;

function dataValida(valor) {
  const d = valor instanceof Date ? valor : new Date(valor);
  return !Number.isNaN(d.getTime()) ? d : null;
}

function normalizar(estado) {
  const e = estado && typeof estado === "object" ? estado : {};
  return {
    etapa: Object.values(ETAPAS).includes(e.etapa) ? e.etapa : ETAPAS.INICIO,
    precoInformadoValor: Number.isFinite(e.precoInformadoValor) ? e.precoInformadoValor : null,
    precoInformadoEm: typeof e.precoInformadoEm === "string" ? e.precoInformadoEm : null,
    cancelamentoPendente: normalizarCancelamento(e.cancelamentoPendente),
  };
}

function normalizarCancelamento(c) {
  if (!c || typeof c !== "object") return null;
  if (!c.slotId || !c.token || !c.criadoEm) return null;
  return {
    slotId: String(c.slotId),
    token: String(c.token),
    criadoEm: String(c.criadoEm),
    crianca: c.crianca ? String(c.crianca) : null,
    label: c.label ? String(c.label) : null,
  };
}

function registrarOferta(estado) {
  const e = normalizar(estado);
  if (e.etapa === ETAPAS.INICIO) e.etapa = ETAPAS.HORARIOS_OFERECIDOS;
  return e;
}

function registrarPreco(estado, valor, agora = new Date()) {
  const e = normalizar(estado);
  const numero = Number(valor);
  const instante = dataValida(agora);
  if (!Number.isFinite(numero) || numero <= 0 || !Number.isInteger(numero) || !instante) return e;
  e.etapa = ETAPAS.PRECO_INFORMADO;
  e.precoInformadoValor = numero;
  e.precoInformadoEm = instante.toISOString();
  return e;
}

function precoFoiInformado(estado, valorEsperado) {
  const e = normalizar(estado);
  return e.precoInformadoValor === Number(valorEsperado) && !!e.precoInformadoEm;
}

function registrarReserva(estado) {
  const e = normalizar(estado);
  e.etapa = ETAPAS.AGUARDANDO_PAGAMENTO;
  return e;
}

function registrarPagamento(estado) {
  const e = normalizar(estado);
  e.etapa = ETAPAS.PAGO;
  return e;
}

function prepararCancelamento(estado, agendamento, agora = new Date()) {
  if (!agendamento || !agendamento.slotId) throw new Error("Agendamento inválido.");
  const instante = dataValida(agora);
  if (!instante) throw new Error("Data de preparação inválida.");
  const e = normalizar(estado);
  e.cancelamentoPendente = {
    slotId: String(agendamento.slotId),
    token: crypto.randomBytes(18).toString("base64url"),
    criadoEm: instante.toISOString(),
    crianca: agendamento.crianca || null,
    label: agendamento.diaLabel || agendamento.label || null,
  };
  return e;
}

function validarCancelamento(estado, { slotId, token }, agora = new Date()) {
  const e = normalizar(estado);
  const p = e.cancelamentoPendente;
  if (!p) return { ok: false, motivo: "Nenhum cancelamento está aguardando confirmação." };
  if (p.slotId !== String(slotId || "")) return { ok: false, motivo: "A confirmação é de outra consulta." };
  const recebido = Buffer.from(String(token || ""));
  const esperado = Buffer.from(p.token);
  if (recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) {
    return { ok: false, motivo: "Confirmação de cancelamento inválida." };
  }
  const criado = new Date(p.criadoEm);
  const instante = dataValida(agora);
  const idade = instante ? instante - criado : Number.POSITIVE_INFINITY;
  if (Number.isNaN(criado.getTime()) || idade < 0 || idade > JANELA_CANCELAMENTO_MS) {
    return { ok: false, motivo: "A confirmação de cancelamento expirou. Consulte a agenda novamente." };
  }
  return { ok: true, pendente: p };
}

function concluirCancelamento(estado) {
  const e = normalizar(estado);
  e.cancelamentoPendente = null;
  return e;
}

function reiniciarConversa() {
  return normalizar(null);
}

module.exports = {
  ETAPAS,
  JANELA_CANCELAMENTO_MS,
  normalizar,
  registrarOferta,
  registrarPreco,
  precoFoiInformado,
  registrarReserva,
  registrarPagamento,
  prepararCancelamento,
  validarCancelamento,
  concluirCancelamento,
  reiniciarConversa,
};
