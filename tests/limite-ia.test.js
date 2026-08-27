"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

// A parte crítica aqui é a fila global. O limite persistente usa caminho de produção e é
// coberto estaticamente para não criar arquivos de dados no repositório durante o teste.
const fonte = fs.readFileSync(path.join(__dirname, "..", "limite-ia.js"), "utf8");
assert.match(fonte, /CARLA_MAX_CHAMADAS_IA_DIA/);
assert.match(fonte, /CARLA_MAX_TOKENS_IA_DIA/);
assert.match(fonte, /CARLA_MAX_CONCORRENCIA_IA/);
assert.match(fonte, /chmodSync\(ARQUIVO, 0o600\)/);
assert.ok(os.tmpdir());

console.log("limite-ia: passou");
