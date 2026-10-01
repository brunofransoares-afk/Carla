/*
 * Bateria: comprovante que chega como IMAGEM passa em silêncio.
 *
 * O print de 01/10/2026, 09:36: a família mandou o comprovante de Pix do PagBank, e a Carla
 * respondeu "Recebi a mídia, mas preciso que você me diga por escrito o que quer que eu
 * observe ou resolva". O dono: "Quando a pessoa envia o comprovante de pagamento, eu não
 * quero que a Carla fale nada. Fique em silêncio."
 *
 * A regra do silêncio já existia, e cobria o comprovante em LINK. O comentário do módulo
 * dizia que imagem "já passa em silêncio hoje (o server só lê texto)", e tinha deixado de ser
 * verdade: quando o servidor passou a pedir descrição de mídia, toda imagem virou aquela
 * frase. Dois acertos separados que, juntos, produziram o erro.
 *
 * COMO O SISTEMA SABE QUE É COMPROVANTE SEM LER A IMAGEM. Pelo contexto: imagem ou PDF
 * chegando de um telefone que tem consulta separada e NÃO PAGA. É a mesma ideia
 * determinística do resto do bot, a certeza vem do estado e não de um palpite sobre o
 * conteúdo. Por isso este arquivo testa as DUAS pontas, e a segunda importa tanto quanto a
 * primeira: sem reserva esperando pagamento, a foto continua recebendo o pedido de descrever,
 * porque ali ela é foto de exame ou de carteira de vacinação.
 *
 * Roda com:  node tests/comprovante-em-imagem.test.js
 */
"use strict";
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const Identidade = require("../identidade-whatsapp.js");
const Texto = require("../texto-da-mensagem.js");
const Comprovante = require("../comprovante-de-pagamento.js");
const { criarMemoriaMensagens } = require("../memoria-mensagens-whatsapp.js");
const { criarFilaPorChave } = require("../fila-por-chave.js");

let passou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

// ------------------------------------------------- 1. a regra, isolada
{
  const COM_RESERVA = [{ telefone: "+5519000000001", pago: false, slotId: "a" }];
  ok(Comprovante.reservaEsperandoPagamento(COM_RESERVA, "+5519000000001"),
    "1. reserva não paga deste telefone é reserva esperando pagamento");
  ok(!Comprovante.reservaEsperandoPagamento([{ telefone: "+5519000000001", pago: true }], "+5519000000001"),
    "1b. reserva já paga não espera nada");
  ok(!Comprovante.reservaEsperandoPagamento(COM_RESERVA, "+5519000000002"),
    "1c. e a reserva de OUTRO telefone não vale: o silêncio é de quem deve, não de quem passa");
  ok(!Comprovante.reservaEsperandoPagamento(null, "+5519000000001"), "1d. lista ausente não derruba");
  ok(!Comprovante.reservaEsperandoPagamento(COM_RESERVA, null), "1e. telefone ausente também não");

  ok(Comprovante.midiaEhComprovante({ ehImagemOuDocumento: true, esperandoPagamento: true }),
    "2. imagem mais reserva esperando pagamento é comprovante");
  ok(!Comprovante.midiaEhComprovante({ ehImagemOuDocumento: true, esperandoPagamento: false }),
    "2b. imagem sem reserva esperando NÃO é: ali é foto de exame, e o pedido de descrever faz sentido");
  ok(!Comprovante.midiaEhComprovante({ ehImagemOuDocumento: false, esperandoPagamento: true }),
    "2c. e texto com reserva esperando também não: isso é conversa, e conversa ela responde");
  ok(!Comprovante.midiaEhComprovante(), "2d. sem argumento nenhum, não é comprovante");

  ok(Texto.ehImagemOuDocumento({ imageMessage: {} }), "3. imagem conta");
  ok(Texto.ehImagemOuDocumento({ documentMessage: {} }), "3b. PDF conta: link de cartão às vezes vem assim");
  ok(Texto.ehImagemOuDocumento({ ephemeralMessage: { message: { imageMessage: {} } } }),
    "3c. e mensagem temporária também, senão quem usa some do filtro");
  ok(!Texto.ehImagemOuDocumento({ videoMessage: {} }), "3d. vídeo não: ninguém manda comprovante em vídeo");
  ok(!Texto.ehImagemOuDocumento({ stickerMessage: {} }), "3e. figurinha também não");
  ok(!Texto.ehImagemOuDocumento({ conversation: "oi" }), "3f. nem texto");
  ok(!Texto.ehImagemOuDocumento(null), "3g. e lixo não derruba");
}

// ------------------------------------------------- 2. o handler de verdade do servidor
async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "carla-comprovante-"));
  let storage;
  try {
    for (const nome of ["storage-node.js", "arquivo-atomico.js", "grade-teleconsulta.js"]) {
      fs.copyFileSync(path.join(__dirname, "..", nome), path.join(temp, nome));
    }
    fs.cpSync(path.join(__dirname, "..", "carla-app"), path.join(temp, "carla-app"), { recursive: true });
    storage = require(path.join(temp, "storage-node.js"));

    const devendo = "+5519000000001";          // tem consulta separada, ainda não paga
    const semReserva = "+5519000000002";       // nunca marcou nada
    const jidDe = (tel) => tel.slice(1) + "@s.whatsapp.net";
    const sock = { signalRepository: { lidMapping: { getPNForLID: async () => null } } };

    const slot = { id: "2099-09-10T09:00", date: "2099-09-10", time: "09:00", label: "10/09 às 09:00" };
    const r = storage.reservar({ slot, responsavel: "Ana", crianca: "Miguel Souza", telefone: devendo });
    ok(r && r.slotId && r.pago === false, "4. a reserva de teste existe e está sem pagar");

    const memoria = criarMemoriaMensagens({ arquivo: path.join(temp, "data", "entradas.json"), agora: () => Date.now() });
    const fila = criarFilaPorChave();
    const timers = [], atendimentos = [], formatos = [];
    const ctx = vm.createContext({
      console: { log() {}, warn() {}, error(...v) { throw new Error(v.join(" ")); } },
      IdentidadeWhatsapp: Identidade, TextoDaMensagem: Texto, Comprovante,
      memoriaMensagens: memoria, Storage: storage, sock, sockAtivo: sock,
      geracao: 1, geracaoConexao: 1, encerrando: false,
      filaMensagens: fila, buffers: new Map(), DEBOUNCE_MS: 6000, LIMITE_TEXTO_ENTRADA: 8000,
      setTimeout: (fn) => { const t = { fn, cancelado: false }; timers.push(t); return t; },
      clearTimeout: (t) => { t.cancelado = true; },
      permitirMensagemDoTelefone: () => true, deveAvisarLimiteDeTaxa: () => true,
      normalizeMessageContent: Texto.desembrulhar,
      reenviarPendentesDoTelefone: async () => {},
      processarMensagem: async (_s, _j, telefone, texto) => { atendimentos.push({ telefone, texto }); },
      processarAudioRecebido: async () => { formatos.push("audio"); },
      processarFormatoNaoEntendido: async (_s, _j, telefone, tipo) => { formatos.push({ telefone, tipo }); },
    });
    const fonte = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    vm.runInContext(fonte.slice(fonte.indexOf("function concluirEntradas("), fonte.indexOf("function sessaoPadrao(")), ctx);
    const inicio = fonte.indexOf("  async function receberMensagens(");
    vm.runInContext(fonte.slice(inicio, fonte.indexOf('  sock.ev.on("messages.upsert"', inicio)), ctx);

    const receber = (mensagens) => ctx.receberMensagens({ messages: mensagens, type: "notify" });
    const midia = (id, tel, message) => ({ key: { id, remoteJid: jidDe(tel) }, messageTimestamp: Date.now() / 1000, message });
    const assentar = async () => {
      for (const t of timers.splice(0)) if (!t.cancelado) t.fn();
      await fila.aguardarVazio();
      await new Promise((resolve) => setImmediate(resolve));
    };

    // --------- o caso do print: comprovante sem legenda, de quem está devendo
    await receber([midia("print-do-pix", devendo, { imageMessage: {} })]);
    await assentar();
    eq(formatos.length, 0, "5. comprovante em imagem NÃO recebe o pedido de descrever");
    eq(atendimentos.length, 0, "5b. e não vai pra IA: ela não pode nem comentar o pagamento");
    const sessao = storage.obterSessao(devendo);
    ok(sessao && /comprovante/.test(sessao.ultimaMensagem || ""),
      "5c. mas o painel vê que chegou alguma coisa, senão o pagamento some em silêncio");
    ok(sessao && sessao.ultimaAtividade, "5d. com a hora, que é o que ordena a fila do painel");

    // --------- com legenda, que é como metade das pessoas manda
    await receber([midia("com-legenda", devendo, { imageMessage: { caption: "segue o comprovante" } })]);
    await assentar();
    eq(formatos.length, 0, "6. com legenda também passa em silêncio");
    eq(atendimentos.length, 0, "6b. e a legenda não vira conversa com a IA");
    eq((storage.obterSessao(devendo) || {}).ultimaMensagem, "segue o comprovante",
      "6c. e é a legenda que o painel mostra, que é mais útil do que um rótulo genérico");

    // --------- PDF, que é o que o link de cartão às vezes gera
    await receber([midia("pdf", devendo, { documentMessage: { mimetype: "application/pdf" } })]);
    await assentar();
    eq(formatos.length, 0, "7. PDF de quem está devendo também passa em silêncio");

    // --------- A OUTRA PONTA: foto de quem não deve nada continua sendo respondida
    await receber([midia("foto-de-exame", semReserva, { imageMessage: {} })]);
    await assentar();
    eq(formatos.length, 1, "8. foto de quem NÃO tem reserva esperando continua recebendo resposta");
    eq((formatos[0] || {}).tipo, "midia", "8b. e é o pedido de descrever, que ali faz sentido");
    eq((formatos[0] || {}).telefone, semReserva, "8c. do telefone certo");

    // --------- e depois de pago, a próxima foto volta a ser foto
    storage.alterarPagamento(r.slotId, true);
    await receber([midia("foto-depois-de-pago", devendo, { imageMessage: {} })]);
    await assentar();
    eq(formatos.length, 2, "9. pago o que devia, a foto seguinte volta a ser tratada como foto");
    eq((formatos[1] || {}).telefone, devendo, "9b. e é dele mesmo");

    // --------- texto continua sendo texto, com reserva aberta ou não
    const r2 = storage.reservar({ slot: { ...slot, id: "2099-09-11T09:00", date: "2099-09-11" }, responsavel: "Ana", crianca: "Miguel Souza", telefone: devendo });
    ok(r2 && r2.slotId, "10. segunda reserva, pra reabrir a dívida");
    await receber([{ key: { id: "fala", remoteJid: jidDe(devendo) }, messageTimestamp: Date.now() / 1000, message: { conversation: "acabei de pagar" } }]);
    await assentar();
    eq(atendimentos.length, 1, "10b. 'acabei de pagar' escrito é conversa, e conversa ela responde");
    eq((atendimentos[0] || {}).texto, "acabei de pagar", "10c. com o texto inteiro");
  } finally {
    if (storage) storage._fecharBancoAgendamentosParaTeste();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().then(() => {
  console.log(`comprovante-em-imagem: ${passou} passaram, ${erros.length} falharam`);
  if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
}).catch((e) => { console.error(e); process.exit(1); });
