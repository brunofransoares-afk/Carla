"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { lerJSONSeguro, escreverJSONAtomico } = require("./arquivo-atomico.js");
const Texto = require("./texto-da-mensagem.js");
const RETENCAO_MS = 7 * 24 * 60 * 60 * 1000;
const LIMITE_PROCESSADAS = 20000;
const LIMITE_PENDENTES = 500;
const hash = (...partes) => crypto.createHash("sha256").update(JSON.stringify(partes)).digest("hex");

function timestampDaMensagem(msg) {
  const valor = msg && msg.messageTimestamp;
  const segundos = typeof valor === "object" && valor !== null && "low" in valor
    ? (valor.low >>> 0) + (valor.high >>> 0) * 4294967296 : Number(valor);
  return Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : null;
}

// Persiste só o necessário para retomar uma entrada, sem chaves, anexos ou dados da sessão
// criptográfica. Áudio e mídia continuam com o mesmo tratamento fixo do servidor.
function resumirMensagem(msg) {
  const c = Texto.desembrulhar(msg.message);
  const texto = Texto.textoDe(c);
  const message = c && c.audioMessage ? { audioMessage: {} }
    : texto ? { conversation: texto.slice(0, 16000) }
    : Texto.ehRecadoDeSistema(c) ? { protocolMessage: {} }
    : Texto.ehMidiaSemTexto(c) ? { imageMessage: {} } : { pollCreationMessage: {} };
  return {
    key: { id: msg.key.id, remoteJid: msg.key.remoteJid, remoteJidAlt: msg.key.remoteJidAlt || null, fromMe: false },
    pushName: String(msg.pushName || "").slice(0, 120),
    messageTimestamp: timestampDaMensagem(msg) ? timestampDaMensagem(msg) / 1000 : null,
    message,
  };
}

function criarMemoriaMensagens({ arquivo, agora = Date.now }) {
  const emCurso = new Set();
  const chavePendente = (msg) => hash(msg.key.remoteJid, msg.key.id);
  const chaveProcessada = (telefone, msg) => hash(telefone, msg.key.id);
  function ler() {
    const dados = lerJSONSeguro(arquivo, { versao: 1, processadas: {}, pendentes: {} });
    if (dados.versao !== 1 || !dados.processadas || !dados.pendentes) throw new Error("Memória de mensagens inválida.");
    return dados;
  }
  function gravar(dados) {
    const validas = Object.entries(dados.processadas).filter(([, em]) => agora() - em < RETENCAO_MS)
      .sort((a, b) => b[1] - a[1]).slice(0, LIMITE_PROCESSADAS);
    dados.processadas = Object.fromEntries(validas);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    escreverJSONAtomico(arquivo, dados);
  }
  function guardar(msg) {
    if (!msg.key || !msg.key.id || String(msg.key.id).length > 200) throw new Error("Mensagem sem identificador válido.");
    const dados = ler(), chave = chavePendente(msg);
    if (dados.pendentes[chave]) return;
    if (Object.keys(dados.pendentes).length >= LIMITE_PENDENTES) throw new Error("Fila de entradas pendentes cheia; verifique a identificação do WhatsApp.");
    dados.pendentes[chave] = { recebidaEm: new Date(agora()).toISOString(), mensagem: resumirMensagem(msg) };
    gravar(dados);
  }
  function concluir(telefone, msg) {
    const dados = ler();
    dados.processadas[chaveProcessada(telefone, msg)] = agora();
    delete dados.pendentes[chavePendente(msg)];
    gravar(dados);
    emCurso.delete(chaveProcessada(telefone, msg));
  }
  function iniciar(telefone, msg, sessao) {
    const chave = chaveProcessada(telefone, msg), dados = ler();
    if (dados.processadas[chave] && agora() - dados.processadas[chave] < RETENCAO_MS) {
      if (dados.pendentes[chavePendente(msg)]) {
        delete dados.pendentes[chavePendente(msg)]; gravar(dados);
      }
      return "repetida";
    }
    if (emCurso.has(chave)) return "em_curso";
    // Transição da versão antiga: os IDs antigos ainda não estavam guardados. Só ignora
    // se o horário ORIGINAL é antigo E o mesmo texto já está no histórico da família.
    // Um novo "sim", "oi" ou "obrigado" nunca é descartado apenas pelo texto.
    const enviadaEm = timestampDaMensagem(msg);
    const ultima = new Date(sessao && sessao.ultimaAtividade || 0).getTime();
    const texto = Texto.textoDe(msg.message);
    const repeticaoAntiga = enviadaEm && enviadaEm < agora() - 5 * 60000 && enviadaEm < ultima - 2 * 60000
      && texto && (sessao && sessao.historico || []).some(m => m.role === "user" && String(m.content).trim() === texto.trim());
    if (repeticaoAntiga) { concluir(telefone, msg); return "antiga"; }
    guardar(msg);
    emCurso.add(chave);
    return "nova";
  }
  return {
    guardar, iniciar, concluir,
    liberar: (telefone, msg) => emCurso.delete(chaveProcessada(telefone, msg)),
    pendentes: () => Object.values(ler().pendentes).map(p => p.mensagem),
  };
}
module.exports = { criarMemoriaMensagens, timestampDaMensagem, RETENCAO_MS };
