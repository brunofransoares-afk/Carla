"use strict";

const assert = require("assert");
const T = require("../triagem-emergencia.js");

assert.equal(T.avaliar("ele não consegue respirar").nivel, "emergencia");
assert.equal(T.avaliar("ela está convulsionando").nivel, "emergencia");
assert.equal(T.avaliar("os lábios ficaram roxos").nivel, "emergencia");
assert.equal(T.avaliar("a boca está arroxeada").nivel, "emergencia");
assert.equal(T.avaliar("ele ficou com os lábios roxos").nivel, "emergencia");
assert.equal(T.avaliar("não está mais com dificuldade para respirar").nivel, "nenhum");
assert.equal(T.avaliar("não teve convulsão").nivel, "nenhum");
assert.equal(T.avaliar("está sem dificuldade para respirar").nivel, "nenhum");
assert.equal(T.avaliar("o cocô tá mole hoje").nivel, "nenhum");
assert.equal(T.avaliar("a criança tá mole").nivel, "confirmar");
assert.equal(T.avaliar("respiração muito rápida").nivel, "confirmar");
assert.equal(T.avaliar("respiração rápida").nivel, "confirmar");
assert.equal(T.avaliar("está sem respirar").nivel, "emergencia");
assert.equal(T.avaliar("engasgou e não consegue respirar").nivel, "emergencia");
assert.equal(T.avaliar("só disse a palavra roxo").nivel, "nenhum");
assert.equal(T.avaliar("não está com os lábios roxos").nivel, "nenhum");
assert.equal(T.respostaConfirmaPerigo("sim, está"), true);
assert.equal(T.respostaConfirmaPerigo("não, é o cocô"), false);
assert.equal(T.respostaConfirmaPerigo("sim, não está mais"), false);
assert.equal(T.avaliar("os lábios ficaram roxos").categoria, "sinal_objetivo");

console.log("triagem-emergencia: passou");
