"use strict";

// Um LID não é telefone. Só o vínculo fornecido pelo WhatsApp autoriza unir identidades;
// nome de perfil, trecho da conversa e semelhança entre números nunca servem de prova.
function telefoneDeJid(jid) {
  const m = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(String(jid || ""));
  return m ? "+" + m[1] : null;
}

function lidDeJid(jid) {
  const m = /^(\d{5,20})(?::\d+)?@lid$/.exec(String(jid || ""));
  return m ? m[1] + "@lid" : null;
}

async function resolverContato(sock, jid, alternativo) {
  const direto = telefoneDeJid(jid);
  if (direto) return { telefone: direto, alias: null };
  const lid = lidDeJid(jid);
  if (!lid) return null;
  let telefone = telefoneDeJid(alternativo);
  if (!telefone) {
    const mapa = sock && sock.signalRepository && sock.signalRepository.lidMapping;
    if (mapa && typeof mapa.getPNForLID === "function") {
      telefone = telefoneDeJid(await mapa.getPNForLID(lid));
    }
  }
  return telefone ? { telefone, alias: "lid:" + lid.split("@")[0] } : null;
}

module.exports = { telefoneDeJid, lidDeJid, resolverContato };
