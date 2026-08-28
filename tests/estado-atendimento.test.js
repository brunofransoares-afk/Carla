"use strict";

const assert = require("assert");
const Estado = require("../estado-atendimento.js");

const agora = new Date("2026-08-27T12:00:00-03:00");
let e = Estado.reiniciarConversa();
assert.equal(e.etapa, "inicio");
assert.equal(Estado.precoFoiInformado(e, 550), false);

e = Estado.registrarOferta(e);
assert.equal(e.etapa, "horarios_oferecidos");
e = Estado.registrarPreco(e, 55000, agora);
assert.equal(Estado.precoFoiInformado(e, 55000), true);
assert.equal(Estado.precoFoiInformado(e, 80000), false);
e = Estado.registrarReserva(e);
assert.equal(e.etapa, "aguardando_pagamento");
e = Estado.registrarPagamento(e);
assert.equal(e.etapa, "pago");

e = Estado.prepararCancelamento(e, {
  slotId: "2026-09-01T09:30", crianca: "Ana Silva", diaLabel: "terça às 9h30",
}, agora);
const token = e.cancelamentoPendente.token;
assert.equal(Estado.validarCancelamento(e, {
  slotId: "2026-09-01T09:30", token,
}, new Date(agora.getTime() + 1000)).ok, true);
assert.equal(Estado.validarCancelamento(e, {
  slotId: "outro", token,
}, agora).ok, false);
assert.equal(Estado.validarCancelamento(e, {
  slotId: "2026-09-01T09:30", token,
}, new Date(agora.getTime() + Estado.JANELA_CANCELAMENTO_MS + 1)).ok, false);
assert.equal(Estado.validarCancelamento(e, {
  slotId: "2026-09-01T09:30", token,
}, new Date(agora.getTime() - 1)).ok, false, "token com data futura também é recusado");
assert.equal(Estado.registrarPreco(e, 55000, new Date("inválida")).precoInformadoEm,
  e.precoInformadoEm, "data inválida não corrompe o estado");
assert.equal(Estado.concluirCancelamento(e).cancelamentoPendente, null);

console.log("estado-atendimento: passou");
