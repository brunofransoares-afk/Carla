"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { DatabaseSync } = require("node:sqlite");

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "carla-backup-"));
const dados = path.join(raiz, "dados");
const backups = path.join(raiz, "backups");
fs.mkdirSync(dados, { recursive: true });
fs.mkdirSync(backups, { recursive: true });

let passou = 0;
const erros = [];
function ok(condicao, mensagem) { if (condicao) passou++; else erros.push(mensagem); }
function eq(atual, esperado, mensagem) {
  ok(atual === esperado, `${mensagem} (esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)})`);
}

const origemDb = path.join(dados, "agendamentos.sqlite");
const db = new DatabaseSync(origemDb);
try {
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE consultas (id INTEGER PRIMARY KEY, nome TEXT)");
  db.prepare("INSERT INTO consultas (nome) VALUES (?)").run("registro-no-wal");
  fs.writeFileSync(path.join(dados, "sessoes.json"), JSON.stringify({ telefone: { ativo: true } }));
  fs.mkdirSync(path.join(backups, "carla-2020-01-01T00-00-00-000Z"));
  fs.mkdirSync(path.join(backups, "carla-2021-01-01T00-00-00-000Z"));

  // Mantém a conexão de origem aberta durante o filho: a cópia precisa incluir inclusive
  // o que ainda está em WAL, sem parar bot nem painel.
  const resultado = spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "backup-dados.js")], {
    encoding: "utf8",
    env: {
      ...process.env,
      CARLA_DATA_DIR: dados,
      CARLA_BACKUP_DIR: backups,
      CARLA_BACKUP_RETER: "2",
    },
  });
  eq(resultado.status, 0, "backup termina com sucesso");

  const pastas = fs.readdirSync(backups).filter((nome) => nome.startsWith("carla-")).sort();
  eq(pastas.length, 2, "retenção preserva somente a quantidade configurada");
  ok(!pastas.includes("carla-2020-01-01T00-00-00-000Z"), "retenção remove primeiro o backup mais antigo");
  const recente = pastas[pastas.length - 1];
  const destino = path.join(backups, recente);
  const manifesto = JSON.parse(fs.readFileSync(path.join(destino, "manifesto-sha256.json"), "utf8"));
  ok(manifesto.arquivos.some((a) => a.arquivo === "agendamentos.sqlite" && /^[a-f0-9]{64}$/.test(a.sha256)),
    "manifesto contém hash da cópia SQLite");
  ok(manifesto.arquivos.some((a) => a.arquivo === "sessoes.json" && /^[a-f0-9]{64}$/.test(a.sha256)),
    "manifesto contém hash dos JSONs");

  const copia = new DatabaseSync(path.join(destino, "agendamentos.sqlite"), { readOnly: true });
  try {
    eq(copia.prepare("SELECT nome FROM consultas").get().nome, "registro-no-wal",
      "snapshot transacional inclui registro ainda coberto por WAL");
    eq(String(Object.values(copia.prepare("PRAGMA integrity_check").get())[0]).toLowerCase(), "ok",
      "snapshot restaurável passa no integrity_check");
  } finally {
    copia.close();
  }
} catch (erro) {
  erros.push(erro && erro.stack ? erro.stack : String(erro));
} finally {
  db.close();
  fs.rmSync(raiz, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

console.log(`backup-dados: ${passou} passaram, ${erros.length} falharam`);
for (const erro of erros) console.log("  FALHOU: " + erro);
process.exit(erros.length ? 1 : 0);
