"use strict";

// aoEnviar recebe o id de cada mensagem que a Carla mandou. É como o bot reconhece, no eco,
// que uma mensagem "enviada pelo número do consultório" foi dela e não do Dr. Bruno digitando
// no celular (ver pausa-pelo-celular.js).
function criarCaixaDeSaida({ storage, prepararMensagem, aplicarEfeito, logger = console, aoEnviar = null }) {
  async function tentarEnviar(sock, pendente, reenvio = false) {
    try {
      let atual = pendente;
      if (!atual.enviadaEm) {
        const enviada = await sock.sendMessage(atual.jid, prepararMensagem(atual.texto));
        if (aoEnviar && enviada && enviada.key && enviada.key.id) {
          try { aoEnviar(enviada.key.id); } catch { /* registro é ajuda, nunca derruba o envio */ }
        }
        atual = storage.marcarMensagemPendenteEnviada(atual.id)
          || { ...atual, enviadaEm: new Date().toISOString() };
        logger.log(`[${reenvio ? "REENVIADA" : "ENVIADA"}] ${atual.telefone}: ${atual.texto}`);
      }
      aplicarEfeito(atual.efeitoAposEnvio);
      storage.removerMensagemPendente(atual.id);
    } catch (erro) {
      try { storage.marcarFalhaMensagemPendente(pendente.id, erro); } catch (erroStorage) {
        logger.error(`[CAIXA DE SAÍDA] Não consegui registrar a falha da mensagem ${pendente.id}:`, erroStorage.message);
      }
      logger.error(`[ERRO AO ENVIAR] ${pendente.telefone}:`, erro.message);
      throw erro;
    }
  }

  async function reenviarDoTelefone(sock, telefone) {
    const pendentes = storage.listarMensagensPendentes(telefone);
    for (const pendente of pendentes) await tentarEnviar(sock, pendente, true);
  }

  return { tentarEnviar, reenviarDoTelefone };
}

module.exports = { criarCaixaDeSaida };
