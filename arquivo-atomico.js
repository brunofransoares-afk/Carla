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
    // Os arquivos guardam conversa, telefone e dados clínicos. O modo nasce restrito em
    // vez de depender do umask da VPS; o rename preserva essas permissões no arquivo final.
    descritor = fs.openSync(temporario, "wx", 0o600);
    fs.writeFileSync(descritor, conteudo, "utf8");
    fs.fsyncSync(descritor);
    fs.closeSync(descritor);
    descritor = null;
    fs.renameSync(temporario, caminho);
    // fsync só no arquivo garante os bytes, mas não necessariamente o rename se a máquina
    // perder energia naquele instante. Sincronizar o diretório fecha essa última janela.
    try {
      const diretorio = fs.openSync(path.dirname(caminho), "r");
      try { fs.fsyncSync(diretorio); } finally { fs.closeSync(diretorio); }
    } catch (erro) {
      // Windows não permite fsync de diretório. O arquivo continua atômico; esta garantia
      // adicional vale nas VPS Linux onde a Carla roda.
      if (process.platform !== "win32") throw erro;
    }
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
