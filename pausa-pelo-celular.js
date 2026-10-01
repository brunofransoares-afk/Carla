"use strict";

// O DR. BRUNO ESCREVEU PELO CELULAR, A CARLA PARA (2026-10-01). O dono: "a Carla está lá
// conversando com um paciente e eu vejo que ela acabou de fazer uma caca. Ao invés de abrir
// o painel e dar silenciar, se eu vou lá e respondo por escrito, qualquer coisa, ela
// automaticamente silencia esse paciente. E depois, se eu quiser voltar ao atendimento
// automático, eu retorno no painel."
//
// É a mesma pausa da mensagem manual do painel (pausadaPeloDoutor): não expira sozinha e só
// o botão "Retomar atendimento automático" da ficha desfaz.
//
// O CUIDADO É NÃO CONFUNDIR AS DUAS VOZES DO MESMO NÚMERO. Tudo que sai do número do
// consultório chega de volta como "enviado por mim", inclusive o que a própria Carla
// mandou. Duas travas, uma em cima da outra:
//
//   1. O eco do que a Carla envia chega como "append" (o Baileys emite assim o que este
//      próprio aparelho mandou); o que ele digita no celular ou no WhatsApp Web chega como
//      "notify". Só "notify" conta.
//   2. Os ids do que a Carla enviou ficam guardados por um tempo; se algum aparecer, não é ele.
//
// E não conta: reação, recado de sistema, mensagem velha (sincronização ao reconectar), e o
// número do próprio Dr. Bruno (é pra lá que vão os avisos da Carla).
const VALIDADE_IDS_MS = 30 * 60 * 1000;
const MAIS_VELHA_QUE_CONTA_MS = 10 * 60 * 1000;

function criarRegistroDeEnvios(agora = () => Date.now()) {
  const ids = new Map();
  function limpar() {
    const corte = agora() - VALIDADE_IDS_MS;
    for (const [id, em] of ids) if (em < corte) ids.delete(id);
  }
  return {
    registrar(id) { if (id) { limpar(); ids.set(String(id), agora()); } },
    foiDaCarla(id) { limpar(); return !!id && ids.has(String(id)); },
  };
}

function segundosDe(timestamp) {
  if (timestamp == null) return null;
  if (typeof timestamp === "number") return timestamp;
  if (typeof timestamp === "object" && typeof timestamp.toNumber === "function") return timestamp.toNumber();
  if (typeof timestamp === "object" && "low" in timestamp) return Number(timestamp.low);
  const n = Number(timestamp);
  return Number.isFinite(n) ? n : null;
}

function ehMensagemDoDoutor({ fromMe, tipoDoLote, sistema, id, timestamp, telefone, telefoneDoDoutor, registro, agora = Date.now() }) {
  if (!fromMe) return false;
  if (tipoDoLote !== "notify") return false;
  if (sistema) return false;
  if (registro && registro.foiDaCarla(id)) return false;
  if (telefoneDoDoutor && telefone === telefoneDoDoutor) return false;
  const s = segundosDe(timestamp);
  if (s != null && agora - s * 1000 > MAIS_VELHA_QUE_CONTA_MS) return false;
  return true;
}

module.exports = { criarRegistroDeEnvios, ehMensagemDoDoutor, VALIDADE_IDS_MS, MAIS_VELHA_QUE_CONTA_MS };
