"use strict";

const fs = require("fs");
const path = require("path");
const { escreverJSONAtomico } = require("./arquivo-atomico.js");

const ARQUIVO = process.env.CARLA_ARQUIVO_USO_IA
  ? path.resolve(process.env.CARLA_ARQUIVO_USO_IA)
  : path.join(__dirname, "data", "uso-ia.json");

function inteiroPositivo(valor, padrao) {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : padrao;
}

const MAX_CHAMADAS_DIA = inteiroPositivo(process.env.CARLA_MAX_CHAMADAS_IA_DIA, 300);
const MAX_TOKENS_DIA = inteiroPositivo(process.env.CARLA_MAX_TOKENS_IA_DIA, 4_000_000);
const MAX_CONCORRENCIA = inteiroPositivo(process.env.CARLA_MAX_CONCORRENCIA_IA, 4);

let emExecucao = 0;
const espera = [];

function diaUtc(agora = new Date()) {
  return agora.toISOString().slice(0, 10);
}

function ler(agora = new Date()) {
  let atual = {};
  try { atual = JSON.parse(fs.readFileSync(ARQUIVO, "utf8")); } catch { /* primeiro uso */ }
  if (atual.dia !== diaUtc(agora)) {
    return { dia: diaUtc(agora), chamadas: 0, tokensEntrada: 0, tokensSaida: 0 };
  }
  return {
    dia: atual.dia,
    chamadas: Number(atual.chamadas) || 0,
    tokensEntrada: Number(atual.tokensEntrada) || 0,
    tokensSaida: Number(atual.tokensSaida) || 0,
  };
}

function gravar(uso) {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  escreverJSONAtomico(ARQUIVO, uso);
  try { fs.chmodSync(ARQUIVO, 0o600); } catch { /* Windows/teste */ }
}

function verificarDisponibilidade(agora = new Date()) {
  const uso = ler(agora);
  const tokens = uso.tokensEntrada + uso.tokensSaida;
  if (uso.chamadas >= MAX_CHAMADAS_DIA || tokens >= MAX_TOKENS_DIA) {
    const erro = new Error("Limite diário de uso da IA atingido.");
    erro.code = "CARLA_LIMITE_IA";
    throw erro;
  }
  return uso;
}

function registrarChamada(agora = new Date()) {
  const uso = verificarDisponibilidade(agora);
  uso.chamadas++;
  gravar(uso);
  return uso;
}

// Só consome uma chamada depois que o SDK aceitou iniciar a operação. Se ele rejeitar a
// configuração de forma síncrona (antes de qualquer request), a cota permanece intacta.
// Falha de rede assíncrona conta: nesse ponto a tentativa de API realmente ocorreu.
function iniciarChamada(iniciar, agora = new Date()) {
  if (typeof iniciar !== "function") throw new TypeError("Iniciador da chamada inválido.");
  verificarDisponibilidade(agora);
  const resultado = iniciar();
  registrarChamada(agora);
  return Promise.resolve(resultado);
}

// Nome antigo mantido para compatibilidade; código novo deve usar iniciarChamada para não
// cobrar tentativas que falhem antes de chegar ao SDK.
const reservarChamada = registrarChamada;

function registrarTokens(usage, agora = new Date()) {
  if (!usage) return;
  const uso = ler(agora);
  uso.tokensEntrada += Number(usage.input_tokens || 0)
    + Number(usage.cache_read_input_tokens || 0)
    + Number(usage.cache_creation_input_tokens || 0);
  uso.tokensSaida += Number(usage.output_tokens || 0);
  gravar(uso);
}

function adquirir() {
  if (emExecucao < MAX_CONCORRENCIA) {
    emExecucao++;
    return Promise.resolve();
  }
  return new Promise((resolve) => espera.push(resolve));
}

function liberar() {
  const proximo = espera.shift();
  if (proximo) {
    // A vaga passa diretamente para quem estava esperando. Decrementar e incrementar em
    // microtasks separadas abria uma janela em que uma terceira chamada furava a fila.
    proximo();
    return;
  }
  emExecucao = Math.max(0, emExecucao - 1);
}

async function comLimiteGlobal(fn) {
  await adquirir();
  try { return await fn(); } finally { liberar(); }
}

module.exports = {
  ARQUIVO,
  MAX_CHAMADAS_DIA,
  MAX_TOKENS_DIA,
  MAX_CONCORRENCIA,
  ler,
  verificarDisponibilidade,
  registrarChamada,
  iniciarChamada,
  reservarChamada,
  registrarTokens,
  comLimiteGlobal,
};
