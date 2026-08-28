"use strict";

const path = require("path");
const crypto = require("crypto");
const AppAgenda = require("./app-agenda.js");
const GoogleAgenda = require("./google-agenda.js");
const { criarCaixaDeEfeitos } = require("./caixa-de-efeitos.js");

function textoObrigatorio(valor, nome) {
  const texto = String(valor || "").trim();
  if (!texto) throw new Error(`${nome} é obrigatório.`);
  return texto;
}

// IDs de evento do Google aceitam os caracteres hexadecimais. Um hash do slot deixa o ID
// estável entre reinícios e transforma uma repetição após queda em HTTP 409 (já criado), não
// num segundo evento no mesmo horário.
function eventIdGoogleDoSlot(slotId) {
  const hash = crypto.createHash("sha256").update(textoObrigatorio(slotId, "slotId")).digest("hex");
  return `carla${hash.slice(0, 48)}`;
}

function criarIntegracoesDuraveis({
  caminho = path.join(__dirname, "data", "efeitos-pendentes.json"),
  appAgenda = AppAgenda,
  googleAgenda = GoogleAgenda,
  logger = console,
  aoVincularAppAgendamento = async () => {},
  aoVincularGoogleEvento = async () => {},
  opcoesCaixa = {},
} = {}) {
  let caixa;

  const chaveVinculoSpi = (slotId) => `spi:vinculo:${slotId}`;
  const chaveCriarSpi = (slotId) => `spi:marcar:${slotId}`;
  const chaveCompletarSpi = (slotId) => `spi:completar:${slotId}`;
  const chaveCancelarSpi = (slotId) => `spi:cancelar:${slotId}`;
  const chaveCriarGoogle = (slotId) => `google:criar:${slotId}`;
  const chaveCancelarGoogle = (eventId) => `google:cancelar:${eventId}`;

  async function registrarVinculoSpi({ slotId, appAgendamentoId }) {
    slotId = textoObrigatorio(slotId, "slotId");
    appAgendamentoId = textoObrigatorio(appAgendamentoId, "appAgendamentoId");
    await caixa.registrar({
      chaveIdempotencia: chaveVinculoSpi(slotId),
      tipo: "interno.vinculo-spi",
      dados: { slotId, appAgendamentoId },
    });

    // E-mail/nascimento e cancelamento podem ter chegado primeiro. Atualizar os efeitos
    // pendentes os torna executáveis sem depender da ordem das mensagens ou das respostas.
    for (const chave of [chaveCompletarSpi(slotId), chaveCancelarSpi(slotId)]) {
      const pendente = await caixa.obter(chave);
      if (pendente) {
        await caixa.registrar({
          chaveIdempotencia: chave,
          tipo: pendente.tipo,
          dados: { appAgendamentoId },
        });
      }
    }
    return appAgendamentoId;
  }

  async function lerVinculoSpi(slotId) {
    const vinculo = await caixa.obter(chaveVinculoSpi(slotId));
    return vinculo?.dados?.appAgendamentoId || null;
  }

  const handlers = {
    "interno.vinculo-spi": async (efeito) => ({
      appAgendamentoId: efeito.dados.appAgendamentoId,
    }),

    "spi.marcar": async (efeito, chaveExecucao) => {
      const dados = efeito.dados;
      const appAgendamentoId = await appAgenda.enviarAgendamentoEstrito({
        ...dados.agendamento,
        inicio: new Date(dados.agendamento.inicio),
        fim: dados.agendamento.fim ? new Date(dados.agendamento.fim) : null,
      }, chaveExecucao);
      await registrarVinculoSpi({ slotId: dados.slotId, appAgendamentoId });
      // A aplicação local pode guardar o ID no agendamento. Se isso falhar, a caixa não
      // confirma o efeito e o repete com a mesma chave, sem duplicar no SPI.
      await aoVincularAppAgendamento(dados.slotId, appAgendamentoId);
      return { slotId: dados.slotId, appAgendamentoId };
    },

    "spi.completar": {
      estaPronto: (efeito) => !!efeito.dados.appAgendamentoId &&
        !!(efeito.dados.email || efeito.dados.dataNascimento),
      executar: async (efeito, chaveExecucao) => appAgenda.completarDadosDoPacienteEstrito({
        appAgendamentoId: efeito.dados.appAgendamentoId,
        email: efeito.dados.email || undefined,
        dataNascimento: efeito.dados.dataNascimento || undefined,
      }, chaveExecucao),
    },

    "spi.cancelar": {
      estaPronto: (efeito) => !!efeito.dados.appAgendamentoId,
      executar: async (efeito, chaveExecucao) => {
        await appAgenda.cancelarAgendamentoEstrito(efeito.dados.appAgendamentoId, chaveExecucao);
        return {
          slotId: efeito.dados.slotId,
          appAgendamentoId: efeito.dados.appAgendamentoId,
          cancelado: true,
        };
      },
    },

    "google.criar": async (efeito) => {
      const dados = efeito.dados;
      const eventId = await googleAgenda.criarEventoEstrito({
        inicio: new Date(dados.inicio),
        fim: new Date(dados.fim),
        titulo: dados.titulo,
        descricao: dados.descricao,
        eventId: dados.eventId,
      });
      await aoVincularGoogleEvento(dados.slotId, eventId);

      const cancelamento = await caixa.obter(chaveCancelarGoogle(eventId));
      if (cancelamento) {
        await caixa.registrar({
          chaveIdempotencia: cancelamento.chaveIdempotencia,
          tipo: "google.cancelar",
          dados: { criacaoConcluida: true },
        });
      }
      return { slotId: dados.slotId, eventId };
    },

    "google.cancelar": {
      estaPronto: (efeito) => !efeito.dados.criacaoRegistrada || !!efeito.dados.criacaoConcluida,
      executar: async (efeito) => {
        await googleAgenda.cancelarEventoEstrito(efeito.dados.eventId);
        return { slotId: efeito.dados.slotId || null, eventId: efeito.dados.eventId, cancelado: true };
      },
    },
  };

  caixa = criarCaixaDeEfeitos({ caminho, handlers, logger, ...opcoesCaixa });

  async function agendarCriacaoSpi({ slotId, dados }) {
    slotId = textoObrigatorio(slotId, "slotId");
    if (!dados || !dados.inicio) throw new Error("dados.inicio é obrigatório para criar no SPI.");
    const agendamento = {
      ...dados,
      inicio: new Date(dados.inicio).toISOString(),
      fim: dados.fim ? new Date(dados.fim).toISOString() : null,
    };
    const efeito = await caixa.registrar({
      chaveIdempotencia: chaveCriarSpi(slotId),
      tipo: "spi.marcar",
      dados: { slotId, agendamento },
      substituirDados: true,
    });
    if (dados.email || dados.dataNascimento) {
      await registrarDadosPaciente({
        slotId,
        email: dados.email,
        dataNascimento: dados.dataNascimento,
      });
    }
    return efeito;
  }

  async function registrarDadosPaciente({ slotId, appAgendamentoId, email, dataNascimento }) {
    slotId = textoObrigatorio(slotId, "slotId");
    if (!email && !dataNascimento) return null;
    if (appAgendamentoId) await registrarVinculoSpi({ slotId, appAgendamentoId });

    let vinculo = await lerVinculoSpi(slotId);
    const dados = { slotId };
    if (email) dados.email = email;
    if (dataNascimento) dados.dataNascimento = dataNascimento;
    if (vinculo) dados.appAgendamentoId = vinculo;

    const efeito = await caixa.registrar({
      chaveIdempotencia: chaveCompletarSpi(slotId),
      tipo: "spi.completar",
      dados,
    });

    // Fecha a janela em que o vínculo poderia ter sido persistido entre a leitura e o
    // registro acima por outro processo.
    vinculo = await lerVinculoSpi(slotId);
    if (vinculo && efeito.dados.appAgendamentoId !== vinculo) {
      return caixa.registrar({
        chaveIdempotencia: chaveCompletarSpi(slotId),
        tipo: "spi.completar",
        dados: { appAgendamentoId: vinculo },
      });
    }
    return efeito;
  }

  async function agendarCancelamentoSpi({ slotId, appAgendamentoId }) {
    slotId = textoObrigatorio(slotId, "slotId");
    if (appAgendamentoId) await registrarVinculoSpi({ slotId, appAgendamentoId });
    let vinculo = appAgendamentoId || await lerVinculoSpi(slotId);
    const efeito = await caixa.registrar({
      chaveIdempotencia: chaveCancelarSpi(slotId),
      tipo: "spi.cancelar",
      dados: { slotId, appAgendamentoId: vinculo || null },
    });
    vinculo = await lerVinculoSpi(slotId);
    if (vinculo && efeito.dados.appAgendamentoId !== vinculo) {
      return caixa.registrar({
        chaveIdempotencia: chaveCancelarSpi(slotId),
        tipo: "spi.cancelar",
        dados: { appAgendamentoId: vinculo },
      });
    }
    return efeito;
  }

  async function agendarCriacaoGoogle({ slotId, inicio, fim, titulo, descricao, eventId }) {
    slotId = textoObrigatorio(slotId, "slotId");
    eventId = eventId || eventIdGoogleDoSlot(slotId);
    const cancelamento = await caixa.obter(chaveCancelarGoogle(eventId));
    if (cancelamento) return { suprimido: true, eventId, cancelamento };

    const efeito = await caixa.registrar({
      chaveIdempotencia: chaveCriarGoogle(slotId),
      tipo: "google.criar",
      dados: {
        slotId,
        eventId,
        inicio: new Date(inicio).toISOString(),
        fim: new Date(fim).toISOString(),
        titulo,
        descricao,
      },
      substituirDados: true,
    });
    return { efeito, eventId };
  }

  async function agendarCancelamentoGoogle({ slotId, eventId }) {
    if (!eventId) eventId = eventIdGoogleDoSlot(textoObrigatorio(slotId, "slotId"));
    const criacao = slotId ? await caixa.obter(chaveCriarGoogle(slotId)) : null;
    const efeito = await caixa.registrar({
      chaveIdempotencia: chaveCancelarGoogle(eventId),
      tipo: "google.cancelar",
      dados: {
        slotId: slotId || null,
        eventId,
        criacaoRegistrada: !!criacao,
        criacaoConcluida: !criacao || criacao.estado === "concluido",
      },
    });
    const criacaoDepois = slotId ? await caixa.obter(chaveCriarGoogle(slotId)) : null;
    if (criacaoDepois?.estado === "concluido" && !efeito.dados.criacaoConcluida) {
      return caixa.registrar({
        chaveIdempotencia: chaveCancelarGoogle(eventId),
        tipo: "google.cancelar",
        dados: { criacaoRegistrada: true, criacaoConcluida: true },
      });
    }
    return efeito;
  }

  function iniciarReconciliacao({ intervaloMs = 15_000, limite = 50 } = {}) {
    let executando = false;
    const rodar = async () => {
      if (executando) return;
      executando = true;
      try { await caixa.reconciliar({ limite }); }
      catch (erro) { logger.error("[EFEITOS] Falha no reconciliador:", erro.message); }
      finally { executando = false; }
    };
    void rodar();
    const timer = setInterval(rodar, intervaloMs);
    if (typeof timer.unref === "function") timer.unref();
    return () => clearInterval(timer);
  }

  return {
    caixa,
    agendarCriacaoSpi,
    registrarVinculoSpi,
    registrarDadosPaciente,
    agendarCancelamentoSpi,
    agendarCriacaoGoogle,
    agendarCancelamentoGoogle,
    reconciliar: (opcoes) => caixa.reconciliar(opcoes),
    iniciarReconciliacao,
    eventIdGoogleDoSlot,
  };
}

module.exports = { criarIntegracoesDuraveis, eventIdGoogleDoSlot };
