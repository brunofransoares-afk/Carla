/* Roda com: node tests/arquivo-atomico.test.js */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { escreverTextoAtomico, escreverJSONAtomico, lerJSONSeguro } = require("../arquivo-atomico.js");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carla-atomico-"));
try {
  const json = path.join(dir, "dados.json");
  escreverJSONAtomico(json, { versao: 1, itens: ["a"] });
  ok(lerJSONSeguro(json, null).versao === 1, "grava e lê JSON válido");
  escreverJSONAtomico(json, { versao: 2, itens: ["a", "b"] });
  const lido = lerJSONSeguro(json, null);
  ok(lido.versao === 2 && lido.itens.length === 2, "substitui o documento inteiro");
  ok(!fs.readdirSync(dir).some((nome) => nome.endsWith(".tmp")), "não deixa temporário depois do rename");

  const texto = path.join(dir, "agenda.csv");
  escreverTextoAtomico(texto, "primeira");
  escreverTextoAtomico(texto, "segunda");
  ok(fs.readFileSync(texto, "utf8") === "segunda", "a escrita atômica também protege CSV");

  fs.writeFileSync(json, "{ arquivo quebrado", "utf8");
  let erroLeitura = null;
  try { lerJSONSeguro(json, []); } catch (erro) { erroLeitura = erro; }
  ok(!!erroLeitura, "JSON existente e inválido interrompe a operação em vez de virar lista vazia");
  ok(fs.readFileSync(json, "utf8") === "{ arquivo quebrado", "o arquivo corrompido original não é alterado");
  const copias = fs.readdirSync(dir).filter((nome) => nome.includes(".corrompido-"));
  ok(copias.length === 1, "cria uma cópia para diagnóstico");
  ok(fs.readFileSync(path.join(dir, copias[0]), "utf8") === "{ arquivo quebrado",
    "a cópia contém exatamente o arquivo que falhou");

  const inexistente = path.join(dir, "novo.json");
  const padrao = [];
  ok(lerJSONSeguro(inexistente, padrao) === padrao, "arquivo inexistente ainda usa o valor inicial");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\narquivo-atomico: ${passou} passaram, ${falhou} falharam`);
if (falhou) {
  erros.forEach((e) => console.log("  FALHOU: " + e));
  process.exit(1);
}
