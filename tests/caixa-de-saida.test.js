/* Roda com: node tests/caixa-de-saida.test.js */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { criarCaixaDeSaida } = require("../caixa-de-saida.js");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }

const base = fs.mkdtempSync(path.join(os.tmpdir(), "carla-saida-"));
const raiz = path.join(base, "bot");
const irma = path.join(raiz, "carla-app", "js");
fs.mkdirSync(path.join(raiz, "data"), { recursive: true });
fs.mkdirSync(irma, { recursive: true });
fs.copyFileSync(path.join(__dirname, "..", "storage-node.js"), path.join(raiz, "storage-node.js"));
fs.copyFileSync(path.join(__dirname, "..", "arquivo-atomico.js"), path.join(raiz, "arquivo-atomico.js"));
fs.writeFileSync(path.join(irma, "config.js"), "global.CARLA_CONFIG = global.CARLA_CONFIG || {};\n");
fs.writeFileSync(path.join(irma, "agenda.js"), "module.exports = {};\n");

let Storage = null;
(async () => {
try {
  Storage = require(path.join(raiz, "storage-node.js"));
  const a = Storage.registrarMensagemPendente({ telefone: "+551", jid: "551@s.whatsapp.net", texto: "mensagem A", chaveIdempotencia: "aviso:1" });
  const aRepetida = Storage.registrarMensagemPendente({ telefone: "+551", jid: "551@s.whatsapp.net", texto: "mensagem A", chaveIdempotencia: "aviso:1" });
  const b = Storage.registrarMensagemPendente({ telefone: "+552", jid: "552@s.whatsapp.net", texto: "mensagem B" });
  ok(a.id !== b.id, "cada saída recebe um identificador único");
  ok(aRepetida.id === a.id, "a mesma chave idempotente não cria uma segunda mensagem");
  ok(Storage.listarMensagensPendentes().length === 2, "as mensagens ficam persistidas antes do envio");
  ok(Storage.listarMensagensPendentes("+551").length === 1, "é possível reenviar na ordem de um telefone");

  Storage.marcarFalhaMensagemPendente(a.id, new Error("rede indisponível"));
  const falha = Storage.listarMensagensPendentes("+551")[0];
  ok(falha.tentativas === 1 && falha.ultimoErro === "rede indisponível", "falha e tentativa ficam registradas");
  ok(Storage.removerMensagemPendente(a.id) === true, "confirmação de envio remove a saída");
  ok(Storage.removerMensagemPendente(a.id) === false, "remoção repetida é inofensiva");
  ok(Storage.listarMensagensPendentes().length === 1, "outras mensagens pendentes são preservadas");

  const arquivo = path.join(raiz, "data", "mensagens-pendentes.json");
  ok(Array.isArray(JSON.parse(fs.readFileSync(arquivo, "utf8"))), "a caixa de saída fica em JSON válido");

  const chamadas = [];
  const itens = new Map();
  const storageFalso = {
    listarMensagensPendentes: (telefone) => [...itens.values()].filter((m) => !telefone || m.telefone === telefone),
    marcarMensagemPendenteEnviada: (id) => {
      const atualizado = { ...itens.get(id), enviadaEm: "agora" };
      itens.set(id, atualizado);
      chamadas.push("marcou-enviada");
      return atualizado;
    },
    marcarFalhaMensagemPendente: (id) => chamadas.push(`falhou:${id}`),
    removerMensagemPendente: (id) => { chamadas.push(`removeu:${id}`); itens.delete(id); },
  };
  const efeitos = [];
  const caixa = criarCaixaDeSaida({
    storage: storageFalso,
    prepararMensagem: (texto) => ({ text: texto }),
    aplicarEfeito: (efeito) => efeitos.push(efeito),
    logger: { log: () => {}, error: () => {} },
  });

  const sucesso = { id: "sucesso", telefone: "+553", jid: "553@s.whatsapp.net", texto: "ok", enviadaEm: null, efeitoAposEnvio: { tipo: "feito" } };
  itens.set(sucesso.id, sucesso);
  let envios = 0;
  await caixa.tentarEnviar({ sendMessage: async () => { envios++; } }, sucesso);
  ok(envios === 1, "saída nova chama a rede uma vez");
  ok(chamadas.indexOf("marcou-enviada") < chamadas.indexOf("removeu:sucesso"),
    "marca entrega antes de remover da caixa");
  ok(efeitos.length === 1 && efeitos[0].tipo === "feito", "efeito posterior só roda depois da entrega");

  const jaEnviada = { id: "efeito", telefone: "+553", jid: "553@s.whatsapp.net", texto: "ok", enviadaEm: "antes", efeitoAposEnvio: { tipo: "retomar" } };
  itens.set(jaEnviada.id, jaEnviada);
  await caixa.tentarEnviar({ sendMessage: async () => { envios++; } }, jaEnviada, true);
  ok(envios === 1, "registro já entregue retoma o efeito sem duplicar WhatsApp");
  ok(efeitos.some((e) => e.tipo === "retomar"), "efeito interrompido é retomado");

  const falhaRede = { id: "falha", telefone: "+554", jid: "554@s.whatsapp.net", texto: "x", enviadaEm: null, efeitoAposEnvio: { tipo: "nao-roda" } };
  itens.set(falhaRede.id, falhaRede);
  let rejeitou = false;
  try { await caixa.tentarEnviar({ sendMessage: async () => { throw new Error("sem rede"); } }, falhaRede); }
  catch { rejeitou = true; }
  ok(rejeitou, "falha da rede é devolvida ao fluxo chamador");
  ok(chamadas.includes("falhou:falha") && itens.has("falha"), "falha continua persistida para reenvio");
  ok(!efeitos.some((e) => e.tipo === "nao-roda"), "efeito posterior não roda sem entrega");

  const servidor = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const posRegistra = servidor.indexOf("const pendente = Storage.registrarMensagemPendente");
  const posSemSocket = servidor.indexOf("if (!sock) return { ok: true, pendente: true", posRegistra);
  const posTentaEnviar = servidor.indexOf("await caixaDeSaida.tentarEnviar(sock, pendente)", posRegistra);
  ok(posRegistra >= 0 && posSemSocket > posRegistra && posTentaEnviar > posSemSocket,
    "enviarResposta persiste antes de olhar a conexão e antes de chamar a rede");
  ok(/connection === "open"[\s\S]*reenviarMensagensPendentes\(sock\)/.test(servidor),
    "a reconexão tenta entregar a caixa de saída");
  const moduloCaixa = fs.readFileSync(path.join(__dirname, "..", "caixa-de-saida.js"), "utf8");
  ok(/\[ERRO AO ENVIAR\][\s\S]*throw erro;/.test(moduloCaixa), "falha não é tratada como sucesso");
} finally {
  if (Storage) Storage._fecharBancoAgendamentosParaTeste();
  fs.rmSync(base, { recursive: true, force: true });
}

console.log(`\ncaixa-de-saida: ${passou} passaram, ${falhou} falharam`);
if (falhou) {
  erros.forEach((e) => console.log("  FALHOU: " + e));
  process.exit(1);
}
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
