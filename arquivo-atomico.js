"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function caminhoTemporario(caminho) {
  const sufixo = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  return path.join(path.dirname(caminho), `.${path.basename(caminho)}.${sufixo}.tmp`);
}

function escreverTextoAtomico(caminho, conteudo) {
  const temporario = caminhoTemporario(caminho);
  let descritor = null;
  try {
    descritor = fs.openSync(temporario, "wx");
    fs.writeFileSync(descritor, conteudo, "utf8");
    fs.fsyncSync(descritor);
    fs.closeSync(descritor);
    descritor = null;
    fs.renameSync(temporario, caminho);
  } finally {
    if (descritor !== null) {
      try { fs.closeSync(descritor); } catch {}
    }
    if (fs.existsSync(temporario)) {
      try { fs.unlinkSync(temporario); } catch {}
    }
  }
}

function escreverJSONAtomico(caminho, dados) {
  escreverTextoAtomico(caminho, JSON.stringify(dados, null, 2));
}

function lerJSONSeguro(caminho, padrao) {
  if (!fs.existsSync(caminho)) return padrao;
  try {
    return JSON.parse(fs.readFileSync(caminho, "utf8"));
  } catch (erro) {
    // Não devolve [] ou {} silenciosamente: isso permitiria que a próxima gravação apagasse
    // dados reais. Preserva uma cópia exata e interrompe a operação para exigir diagnóstico.
    const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
    const copia = `${caminho}.corrompido-${carimbo}`;
    try { fs.copyFileSync(caminho, copia, fs.constants.COPYFILE_EXCL); } catch {}
    const falha = new Error(`JSON inválido em ${caminho}. O arquivo foi preservado para diagnóstico em ${copia}.`);
    falha.cause = erro;
    falha.caminhoCorrompido = caminho;
    falha.copiaDiagnostico = copia;
    throw falha;
  }
}

module.exports = { escreverTextoAtomico, escreverJSONAtomico, lerJSONSeguro };
