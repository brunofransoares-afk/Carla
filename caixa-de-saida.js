"use strict";

function criarCaixaDeSaida({ storage, prepararMensagem, aplicarEfeito, logger = console }) {
  async function tentarEnviar(sock, pendente, reenvio = false) {
    try {
      let atual = pendente;
      if (!atual.enviadaEm) {
        await sock.sendMessage(atual.jid, prepararMensagem(atual.texto));
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
