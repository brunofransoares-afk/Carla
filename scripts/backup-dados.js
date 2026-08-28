"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const RAIZ_PROJETO = path.resolve(__dirname, "..");
const ORIGEM = path.resolve(process.env.CARLA_DATA_DIR || path.join(RAIZ_PROJETO, "data"));
const RAIZ_BACKUPS = path.resolve(
  process.env.CARLA_BACKUP_DIR || path.join(RAIZ_PROJETO, "..", "backups")
);
const RETENCAO = Math.min(Math.max(Number(process.env.CARLA_BACKUP_RETER) || 30, 1), 365);
const MARCA = new Date().toISOString().replace(/[:.]/g, "-");
const DESTINO = path.join(RAIZ_BACKUPS, `carla-${MARCA}`);

function filhoDiretoSeguro(caminho) {
  const relativo = path.relative(RAIZ_BACKUPS, path.resolve(caminho));
  return relativo && !relativo.startsWith("..") && !path.isAbsolute(relativo) &&
    !relativo.includes(path.sep) && /^carla-\d{4}-\d{2}-\d{2}T/.test(relativo);
}

function hashArquivo(caminho) {
  return crypto.createHash("sha256").update(fs.readFileSync(caminho)).digest("hex");
}

function copiarArvore(origem, destino, manifest, relativo = "") {
  for (const entrada of fs.readdirSync(origem, { withFileTypes: true })) {
    if (entrada.name === "agendamentos.sqlite" ||
        entrada.name.endsWith("-wal") || entrada.name.endsWith("-shm") ||
        entrada.name.endsWith(".lock") || entrada.name.includes(".tmp-")) continue;

    const de = path.join(origem, entrada.name);
    const rel = path.join(relativo, entrada.name);
    const para = path.join(destino, entrada.name);
    if (entrada.isDirectory()) {
      fs.mkdirSync(para, { recursive: true, mode: 0o700 });
      copiarArvore(de, para, manifest, rel);
      continue;
    }
    if (!entrada.isFile()) continue;
    try {
      fs.copyFileSync(de, para);
      fs.chmodSync(para, 0o600);
      manifest.push({ arquivo: rel.replace(/\\/g, "/"), sha256: hashArquivo(para) });
    } catch (erro) {
      // Arquivos atômicos podem trocar de nome entre o readdir e a cópia. O arquivo final
      // será visto na próxima execução; temporários nunca são necessários para restauração.
      if (!erro || erro.code !== "ENOENT") throw erro;
    }
  }
}

function snapshotAgenda(destino, manifest) {
  const origemDb = path.join(ORIGEM, "agendamentos.sqlite");
  if (!fs.existsSync(origemDb)) return;
  const destinoDb = path.join(destino, "agendamentos.sqlite");
  const db = new DatabaseSync(origemDb, { readOnly: true });
  try {
    // VACUUM INTO produz uma cópia transacional completa, inclusive quando a agenda está
    // em WAL e bot/painel continuam atendendo durante o backup.
    const literal = destinoDb.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${literal}'`);
  } finally {
    db.close();
  }
  fs.chmodSync(destinoDb, 0o600);
  const copia = new DatabaseSync(destinoDb, { readOnly: true });
  try {
    const resultado = copia.prepare("PRAGMA integrity_check").get();
    if (!resultado || String(Object.values(resultado)[0]).toLowerCase() !== "ok") {
      throw new Error("A cópia SQLite não passou no integrity_check.");
    }
  } finally {
    copia.close();
  }
  manifest.push({ arquivo: "agendamentos.sqlite", sha256: hashArquivo(destinoDb) });
}

function aplicarRetencao() {
  const anteriores = fs.readdirSync(RAIZ_BACKUPS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && filhoDiretoSeguro(path.join(RAIZ_BACKUPS, e.name)))
    .map((e) => e.name).sort().reverse();
  for (const nome of anteriores.slice(RETENCAO)) {
    const alvo = path.join(RAIZ_BACKUPS, nome);
    if (!filhoDiretoSeguro(alvo)) throw new Error(`Recusa remover backup fora da raiz: ${alvo}`);
    fs.rmSync(alvo, { recursive: true, force: false });
  }
}

function executar() {
  fs.mkdirSync(RAIZ_BACKUPS, { recursive: true, mode: 0o700 });
  fs.chmodSync(RAIZ_BACKUPS, 0o700);
  if (!filhoDiretoSeguro(DESTINO)) throw new Error("Destino de backup recusado.");
  fs.mkdirSync(DESTINO, { mode: 0o700 });
  const manifest = [];
  try {
    if (fs.existsSync(ORIGEM)) copiarArvore(ORIGEM, DESTINO, manifest);
    snapshotAgenda(DESTINO, manifest);
    manifest.sort((a, b) => a.arquivo.localeCompare(b.arquivo));
    const arquivoManifest = path.join(DESTINO, "manifesto-sha256.json");
    fs.writeFileSync(arquivoManifest, JSON.stringify({ criadoEm: new Date().toISOString(), arquivos: manifest }, null, 2), { mode: 0o600 });
    aplicarRetencao();
    console.log(`Backup verificado: ${DESTINO} (${manifest.length} arquivos).`);
  } catch (erro) {
    if (filhoDiretoSeguro(DESTINO) && fs.existsSync(DESTINO)) {
      fs.rmSync(DESTINO, { recursive: true, force: true });
    }
    throw erro;
  }
}

executar();
