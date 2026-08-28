"use strict";

const util = require("util");

// Esses eventos carregam texto livre, nome de criança, telefone ou informação clínica.
// Mantemos o tipo do evento (útil para operar a Carla), mas nunca o conteúdo. A lista é
// deliberadamente ampla: um log um pouco menos detalhado é reversível; prontuário em log não.
const EVENTOS_COM_CONTEUDO_CLINICO = /^(\s*)\[((?:RECEBIDA|ALERTA:[^\]]*|REAQUECIDO|RESPOSTA DO DOUTOR|DADOS DO PORTAL|FERRAMENTA(?: ->)?|SEGURANÇA|AGENDADO|CANCELADO PELA IA|LEMBRETE[^\]]*|GUIA|PAGAMENTO|PORTAL|NOTIFICAÇÃO|COMPROVANTE|SESSÃO|SILÊNCIO PROPOSITAL|IGNORADO[^\]]*|MÍDIA SEM TEXTO|SEM TEXTO|APRESENTAÇÃO))\]/;

function redigir(valor) {
  let texto = typeof valor === "string"
    ? valor
    : valor instanceof Error
      ? (valor.stack || valor.message)
      : util.inspect(valor, { depth: 5, breakLength: 120 });

  const evento = texto.match(EVENTOS_COM_CONTEUDO_CLINICO);
  if (evento) return `${evento[1]}[${evento[2]}] conteúdo sensível omitido`;

  return texto
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
    .replace(/\b\d{5,20}(?::\d+)?@(?:s\.whatsapp\.net|lid)\b/gi, "[JID]")
    .replace(/\+?\d{10,13}\b/g, "[TELEFONE]")
    .replace(/\b(sk-ant-[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._~+\/-]+=*)\b/gi, "[SEGREDO]")
    .replace(/((?:senha|password|secret|token|authorization|api[_-]?key)\s*[=:]\s*)[^\s,;}]+/gi, "$1[SEGREDO]");
}

function instalarConsoleSeguro() {
  if (global.__carlaConsoleSeguroInstalado || process.env.CARLA_LOG_REDACT === "0") return;
  global.__carlaConsoleSeguroInstalado = true;
  const maximo = Math.min(Math.max(Number(process.env.CARLA_LOG_MAX_LINE) || 2000, 200), 10000);
  for (const metodo of ["log", "info", "warn", "error", "debug"]) {
    const original = console[metodo].bind(console);
    // Formatar primeiro é importante: `console.error("[NOTIFICAÇÃO]", erro)` não pode
    // redigir só o primeiro argumento e deixar o segundo — que pode ter dado clínico — cru.
    console[metodo] = (...args) => original(redigir(util.format(...args)).slice(0, maximo));
  }
}

instalarConsoleSeguro();

module.exports = { instalarConsoleSeguro, redigir };
