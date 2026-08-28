"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "carla-status-whatsapp-"));
process.env.CARLA_STATUS_WHATSAPP = path.join(pasta, "status.json");
const Status = require(path.join(__dirname, "..", "status-whatsapp.js"));

let passou = 0;
const erros = [];
function ok(condicao, mensagem) { if (condicao) passou++; else erros.push(mensagem); }
function eq(atual, esperado, mensagem) {
  ok(atual === esperado, `${mensagem} (esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)})`);
}

try {
  eq(Status.ler().estado, "desconhecido", "arquivo ausente não mente que está conectado");

  const base = new Date("2026-08-27T12:00:00.000Z");
  Status.registrar("conectado", { agora: base, pid: 123 });
  const conectado = Status.ler({ pidEsperado: 123, agora: new Date(base.getTime() + 60_000) });
  eq(conectado.conectado, true, "pulso recente do mesmo processo confirma a conexão");

  const outroProcesso = Status.ler({ pidEsperado: 456, agora: base });
  eq(outroProcesso.conectado, false, "status de processo antigo não vale depois do restart");
  eq(outroProcesso.estado, "conectando", "processo novo aparece como conectando");

  const vencido = Status.ler({ pidEsperado: 123, agora: new Date(base.getTime() + Status.VALIDADE_MS + 1) });
  eq(vencido.estado, "sem_sinal", "pulso vencido aparece como sem sinal");
  eq(vencido.conectado, false, "pulso vencido nunca aparece verde");

  const desligado = Status.resumir({ rodando: false, existe: true, pid: 123, agora: base });
  eq(desligado.whatsappEstado, "desligado", "PM2 parado prevalece sobre arquivo antigo");

  Status.registrar("sessao_desconectada", { agora: base, pid: 123 });
  const saiu = Status.resumir({ rodando: true, existe: true, pid: 123, agora: base });
  eq(saiu.whatsappEstado, "sessao_desconectada", "logout do WhatsApp fica explícito no painel");
  eq(saiu.whatsappConectado, false, "logout não aparece como conectado");
} finally {
  fs.rmSync(pasta, { recursive: true, force: true });
}

console.log(`status-whatsapp: ${passou} passaram, ${erros.length} falharam`);
for (const erro of erros) console.log("  FALHOU: " + erro);
process.exit(erros.length ? 1 : 0);
