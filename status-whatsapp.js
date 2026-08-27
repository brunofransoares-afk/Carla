"use strict";

const fs = require("fs");
const path = require("path");
const { escreverJSONAtomico } = require("./arquivo-atomico.js");

const ARQUIVO = process.env.CARLA_STATUS_WHATSAPP
  ? path.resolve(process.env.CARLA_STATUS_WHATSAPP)
  : path.join(__dirname, "data", "status-whatsapp.json");
const VALIDADE_MS = 3 * 60 * 1000;
const ESTADOS = new Set([
  "conectando",
  "conectado",
  "reconectando",
  "sessao_desconectada",
  "parando",
]);

function registrar(estado, { agora = new Date(), pid = process.pid } = {}) {
  if (!ESTADOS.has(estado)) throw new Error(`Estado do WhatsApp inválido: ${estado}`);
  const instante = agora instanceof Date ? agora : new Date(agora);
  if (Number.isNaN(instante.getTime())) throw new Error("Data do estado do WhatsApp inválida.");
  const registro = {
    versao: 1,
    estado,
    conectado: estado === "conectado",
    pid: Number(pid) || null,
    atualizadoEm: instante.toISOString(),
  };
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  escreverJSONAtomico(ARQUIVO, registro);
  return registro;
}

function desconhecido(estado = "desconhecido", atualizadoEm = null) {
  return { estado, conectado: false, atualizadoEm };
}

function ler({ pidEsperado = null, agora = new Date(), validadeMs = VALIDADE_MS } = {}) {
  let registro;
  try {
    registro = JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));
  } catch {
    return desconhecido();
  }
  if (!registro || !ESTADOS.has(registro.estado)) return desconhecido();
  if (pidEsperado != null && Number(registro.pid) !== Number(pidEsperado)) {
    return desconhecido("conectando", registro.atualizadoEm || null);
  }
  const instante = agora instanceof Date ? agora : new Date(agora);
  const atualizado = new Date(registro.atualizadoEm || 0);
  if (Number.isNaN(instante.getTime()) || Number.isNaN(atualizado.getTime())) return desconhecido();
  const idade = instante.getTime() - atualizado.getTime();
  if (idade < -60_000 || idade > validadeMs) {
    return desconhecido("sem_sinal", registro.atualizadoEm || null);
  }
  return {
    estado: registro.estado,
    conectado: registro.estado === "conectado" && registro.conectado === true,
    atualizadoEm: registro.atualizadoEm,
  };
}

function resumir({ rodando, existe, pid, agora = new Date() }) {
  if (!rodando) {
    return {
      rodando: false,
      existe: !!existe,
      whatsappConectado: false,
      whatsappEstado: "desligado",
      whatsappAtualizadoEm: null,
    };
  }
  const whatsapp = ler({ pidEsperado: pid, agora });
  return {
    rodando: true,
    existe: !!existe,
    whatsappConectado: whatsapp.conectado,
    whatsappEstado: whatsapp.estado,
    whatsappAtualizadoEm: whatsapp.atualizadoEm,
  };
}

module.exports = { ARQUIVO, ESTADOS, VALIDADE_MS, registrar, ler, resumir };
