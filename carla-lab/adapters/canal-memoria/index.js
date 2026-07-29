// Canal em memória: guarda o que seria enviado, em vez de enviar.
//
// É o que permite testar a conversa inteira sem que uma única mensagem chegue a alguém.
// Um teste que manda WhatsApp de verdade é pior do que não testar.

function criar() {
  const enviadas = [];
  let aoReceberCallback = null;
  let conectado = false;

  return {
    nome: "canal-memoria",
    enviadas,

    enviarTexto: async (telefone, texto) => {
      enviadas.push({ telefone, texto });
    },

    aoReceber: (callback) => {
      aoReceberCallback = callback;
    },

    conectar: async () => {
      conectado = true; // idempotente de propósito
    },

    // Simula a chegada de uma mensagem, para o teste dirigir a conversa.
    _receber: (mensagem) => {
      if (!aoReceberCallback) throw new Error("ninguém registrou aoReceber");
      return aoReceberCallback(mensagem);
    },
    _estaConectado: () => conectado,
    _ultimaEnviada: () => enviadas[enviadas.length - 1] || null,
  };
}

module.exports = { criar };
