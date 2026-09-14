"use strict";
const crypto = require("crypto");
const Avisos = require("./avisos-texto.js");

function criarAvisadorPortalManual({ storage, fila, enviar, endereco, contatoExiste }) {
  return async function avisar(dados) {
    const preparo = Avisos.prepararPortalManual({ ...dados, endereco: endereco() });
    if (!preparo.ok) return preparo;
    const telefone = dados.telefone;
    // O e-mail digitado aqui é explícito: não procurar outro paciente pelo e-mail.
    if (!contatoExiste(telefone)) return { ok: false, motivo: "Família não encontrada no painel." };
    const chave = "portal-manual:" + crypto.createHash("sha256")
      .update(JSON.stringify([telefone, preparo.email.toLowerCase()])).digest("hex");
    return fila.enfileirar(telefone, async () => {
      if (storage.portalManualAvisado(telefone, chave)) return { ok: true, jaAvisado: true };
      if (storage.listarMensagensPendentes(telefone).some((m) => m.chaveIdempotencia === chave)) {
        return { ok: true, pendente: true };
      }
      return enviar(telefone, preparo.texto, {
        chaveIdempotencia: chave,
        efeitoAposEnvio: { tipo: "marcar_portal_manual", telefone, chave },
        registrarNoHistorico: true,
      });
    });
  };
}
module.exports = { criarAvisadorPortalManual };
