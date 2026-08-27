"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { escreverJSONAtomico, lerJSONSeguro } = require("./arquivo-atomico.js");

const ESTADOS = new Set(["pendente", "concluido", "falhou"]);

function pausa(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function copia(valor) {
  return valor == null ? valor : JSON.parse(JSON.stringify(valor));
}

function objeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function mesmoJSON(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function criarCaixaDeEfeitos({
  caminho = path.join(__dirname, "data", "efeitos-pendentes.json"),
  handlers = {},
  logger = console,
  agora = () => new Date(),
  aleatorio = Math.random,
  atrasoBaseMs = 5_000,
  atrasoMaximoMs = 30 * 60_000,
  duracaoLeaseMs = 30_000,
  esperaLockMs = 10,
  lockExpiraMs = 60_000,
} = {}) {
  const caminhoLock = `${caminho}.lock`;

  function estadoInicial() {
    return { versao: 1, efeitos: [] };
  }

  function lerEstado() {
    const lido = lerJSONSeguro(caminho, estadoInicial());
    if (!lido || !Array.isArray(lido.efeitos)) {
      throw new Error(`Formato inválido da caixa de efeitos em ${caminho}.`);
    }
    return lido;
  }

  function gravarEstado(estado) {
    fs.mkdirSync(path.dirname(caminho), { recursive: true });
    escreverJSONAtomico(caminho, estado);
    // A fila pode conter nome, telefone, e-mail e nascimento. Na VPS só o usuário do
    // processo deve conseguir lê-la, independentemente do umask do sistema.
    try { fs.chmodSync(caminho, 0o600); } catch (erro) {
      if (process.platform !== "win32") throw erro;
    }
  }

  async function adquirirLock() {
    fs.mkdirSync(path.dirname(caminho), { recursive: true });
    const limite = Date.now() + Math.max(lockExpiraMs * 2, 5_000);
    while (true) {
      try {
        const descritor = fs.openSync(caminhoLock, "wx", 0o600);
        fs.writeFileSync(descritor, JSON.stringify({ pid: process.pid, criadoEm: new Date().toISOString() }));
        fs.closeSync(descritor);
        return;
      } catch (erro) {
        if (erro.code !== "EEXIST") throw erro;
        try {
          const idade = Date.now() - fs.statSync(caminhoLock).mtimeMs;
          if (idade > lockExpiraMs) {
            fs.unlinkSync(caminhoLock);
            continue;
          }
        } catch (erroLock) {
          if (erroLock.code === "ENOENT") continue;
        }
        if (Date.now() >= limite) throw new Error(`Timeout esperando lock da caixa de efeitos: ${caminhoLock}`);
        await pausa(esperaLockMs);
      }
    }
  }

  function liberarLock() {
    try { fs.unlinkSync(caminhoLock); } catch (erro) {
      if (erro.code !== "ENOENT") logger.error("[EFEITOS] Não consegui liberar o lock:", erro.message);
    }
  }

  async function comLock(operacao) {
    await adquirirLock();
    try { return await operacao(); } finally { liberarLock(); }
  }

  function validarEntrada(entrada) {
    if (!entrada || typeof entrada !== "object") throw new Error("Efeito ausente.");
    if (!String(entrada.chaveIdempotencia || "").trim()) throw new Error("chaveIdempotencia é obrigatória.");
    if (!String(entrada.tipo || "").trim()) throw new Error("tipo é obrigatório.");
  }

  async function registrar(entrada) {
    validarEntrada(entrada);
    return comLock(() => {
      const estado = lerEstado();
      const chave = String(entrada.chaveIdempotencia).trim();
      const existente = estado.efeitos.find((item) => item.chaveIdempotencia === chave);
      const dadosNovos = copia(objeto(entrada.dados));
      const instante = agora().toISOString();

      if (existente) {
        if (existente.tipo !== entrada.tipo) {
          throw new Error(`A chave ${chave} já pertence ao tipo ${existente.tipo}.`);
        }
        const combinados = entrada.substituirDados
          ? dadosNovos
          : { ...objeto(existente.dados), ...dadosNovos };
        if (!mesmoJSON(combinados, existente.dados)) {
          existente.dados = combinados;
          existente.revisao = Number(existente.revisao || 1) + 1;
          existente.estado = "pendente";
          existente.proximaTentativaEm = instante;
          existente.ultimoErro = null;
          existente.resultado = null;
          existente.lease = null;
          existente.atualizadoEm = instante;
          gravarEstado(estado);
        }
        return copia(existente);
      }

      const novo = {
        id: crypto.randomUUID(),
        chaveIdempotencia: chave,
        tipo: String(entrada.tipo).trim(),
        dados: dadosNovos,
        estado: "pendente",
        revisao: 1,
        tentativas: 0,
        criadoEm: instante,
        atualizadoEm: instante,
        proximaTentativaEm: instante,
        concluidoEm: null,
        ultimoErro: null,
        resultado: null,
        lease: null,
      };
      estado.efeitos.push(novo);
      gravarEstado(estado);
      return copia(novo);
    });
  }

  async function obter(chaveIdempotencia) {
    return comLock(() => {
      const efeito = lerEstado().efeitos.find((item) => item.chaveIdempotencia === chaveIdempotencia);
      return copia(efeito || null);
    });
  }

  async function listar({ estados } = {}) {
    return comLock(() => {
      const filtro = estados ? new Set(estados) : null;
      return copia(lerEstado().efeitos.filter((item) => !filtro || filtro.has(item.estado)));
    });
  }

  function handlerDo(efeito) {
    const entrada = handlers[efeito.tipo];
    if (typeof entrada === "function") return { executar: entrada };
    return entrada || null;
  }

  async function reivindicarProximo() {
    return comLock(async () => {
      const estado = lerEstado();
      const instante = agora();
      const instanteMs = instante.getTime();
      let mudou = false;

      for (const efeito of estado.efeitos) {
        if (!ESTADOS.has(efeito.estado)) throw new Error(`Estado desconhecido no efeito ${efeito.id}.`);
        if (efeito.estado === "concluido") continue;
        if (new Date(efeito.proximaTentativaEm || 0).getTime() > instanteMs) continue;
        if (efeito.lease && new Date(efeito.lease.ate).getTime() > instanteMs) continue;

        const handler = handlerDo(efeito);
        if (!handler || typeof handler.executar !== "function") continue;
        if (handler.estaPronto && !(await handler.estaPronto(copia(efeito)))) continue;

        efeito.lease = {
          id: crypto.randomUUID(),
          ate: new Date(instanteMs + duracaoLeaseMs).toISOString(),
        };
        efeito.tentativas = Number(efeito.tentativas || 0) + 1;
        efeito.atualizadoEm = instante.toISOString();
        mudou = true;
        gravarEstado(estado);
        return copia(efeito);
      }

      if (mudou) gravarEstado(estado);
      return null;
    });
  }

  async function finalizarTentativa(reivindicado, erro, resultado) {
    return comLock(() => {
      const estado = lerEstado();
      const atual = estado.efeitos.find((item) => item.id === reivindicado.id);
      if (!atual || atual.lease?.id !== reivindicado.lease?.id) return null;

      const instante = agora();
      atual.lease = null;
      atual.atualizadoEm = instante.toISOString();
      if (!erro) {
        atual.estado = "concluido";
        atual.concluidoEm = instante.toISOString();
        atual.proximaTentativaEm = null;
        atual.ultimoErro = null;
        atual.resultado = copia(resultado == null ? null : resultado);
      } else {
        const expoente = Math.max(0, Number(atual.tentativas || 1) - 1);
        const semJitter = Math.min(atrasoMaximoMs, atrasoBaseMs * (2 ** expoente));
        const jitter = 0.75 + (Math.max(0, Math.min(1, aleatorio())) * 0.5);
        atual.estado = "falhou";
        atual.ultimoErro = String(erro && erro.message || erro || "Falha desconhecida").slice(0, 1_000);
        atual.proximaTentativaEm = new Date(instante.getTime() + Math.round(semJitter * jitter)).toISOString();
      }
      gravarEstado(estado);
      return copia(atual);
    });
  }

  async function reconciliar({ limite = 50 } = {}) {
    const resumo = { executados: 0, concluidos: [], falhos: [] };
    for (let indice = 0; indice < limite; indice++) {
      const efeito = await reivindicarProximo();
      if (!efeito) break;
      resumo.executados++;
      const handler = handlerDo(efeito);
      try {
        const chaveExecucao = `${efeito.chaveIdempotencia}:v${efeito.revisao || 1}`;
        const resultado = await handler.executar(copia(efeito), chaveExecucao);
        const final = await finalizarTentativa(efeito, null, resultado);
        if (final) resumo.concluidos.push(final);
      } catch (erro) {
        const final = await finalizarTentativa(efeito, erro);
        if (final) resumo.falhos.push(final);
        logger.error(`[EFEITOS] ${efeito.tipo} (${efeito.chaveIdempotencia}) falhou:`, erro.message);
      }
    }
    return resumo;
  }

  async function forcarReprocessamento(chaveIdempotencia) {
    return comLock(() => {
      const estado = lerEstado();
      const efeito = estado.efeitos.find((item) => item.chaveIdempotencia === chaveIdempotencia);
      if (!efeito) return null;
      efeito.estado = "pendente";
      efeito.proximaTentativaEm = agora().toISOString();
      efeito.concluidoEm = null;
      efeito.ultimoErro = null;
      efeito.lease = null;
      efeito.atualizadoEm = agora().toISOString();
      gravarEstado(estado);
      return copia(efeito);
    });
  }

  return { registrar, obter, listar, reconciliar, forcarReprocessamento, caminho };
}

module.exports = { criarCaixaDeEfeitos };
