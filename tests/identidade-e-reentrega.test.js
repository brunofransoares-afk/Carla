"use strict";
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const Identidade = require("../identidade-whatsapp.js");
const Texto = require("../texto-da-mensagem.js");
const { criarMemoriaMensagens, timestampDaMensagem } = require("../memoria-mensagens-whatsapp.js");
const { criarFilaPorChave } = require("../fila-por-chave.js");

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "carla-identidade-"));
  let storage;
  try {
    for (const nome of ["storage-node.js", "arquivo-atomico.js", "grade-teleconsulta.js"]) {
      fs.copyFileSync(path.join(__dirname, "..", nome), path.join(temp, nome));
    }
    fs.cpSync(path.join(__dirname, "..", "carla-app"), path.join(temp, "carla-app"), { recursive: true });
    storage = require(path.join(temp, "storage-node.js"));
    const tel = "+5519000000001", pn = tel.slice(1) + "@s.whatsapp.net", lid = "123456789012345@lid", alias = "lid:123456789012345";
    const mapa = new Map([[lid, pn]]);
    const sock = { signalRepository: { lidMapping: { getPNForLID: async (id) => mapa.get(id) } } };
    assert.deepEqual(await Identidade.resolverContato(sock, lid), { telefone: tel, alias });
    assert.deepEqual(await Identidade.resolverContato({}, lid, pn), { telefone: tel, alias });
    assert.equal((await Identidade.resolverContato(sock, "16195550123:2@s.whatsapp.net")).telefone, "+16195550123");
    assert.equal(await Identidade.resolverContato(sock, "12345@g.us"), null);
    assert.equal(await Identidade.resolverContato({}, lid), null);
    assert.equal(await Identidade.resolverContato(sock, "abacaxi@lid"), null);
    assert.equal(timestampDaMensagem({ messageTimestamp: { low: 1789392000, high: 0 } }), 1789392000000);

    const historico = [{ role: "user", content: "Boa tarde! Tudo bem?" }, { role: "assistant", content: "Consulta reservada." }, { role: "user", content: "Obrigado, igualmente!" }];
    let agora = Date.parse("2026-09-14T17:02:00Z");
    storage.salvarSessao(tel, { telefone: tel, historico, ultimaAtividade: new Date(agora + 9 * 60000).toISOString(), ultimoAgendamento: { slotId: "consulta-preservada" } });
    storage.salvarSessao(alias, { historico: [{ role: "assistant", content: "Apresentação duplicada antiga" }], pausadaPeloDoutor: true, aguardandoHumano: true, ultimaAtividade: new Date(agora).toISOString() });
    storage.registrarContatoWhatsapp(alias, { pushName: "Família de teste" });
    storage.marcarApresentacao(alias);
    storage.silenciarContato(alias);
    storage.vincularIdentidadeWhatsapp(alias, tel);
    assert.deepEqual(storage.obterSessao(tel).historico, historico, "não troca a consulta completa pela saudação duplicada");
    assert.equal(storage.obterSessao(tel).ultimoAgendamento.slotId, "consulta-preservada");
    assert.equal(storage.contatoSilenciado(tel), true);
    assert.equal(storage.obterSessao(tel).pausadaPeloDoutor, true);
    assert.equal(storage.jaSeApresentou(tel), true);
    assert.equal(storage.listarTodosContatos().some(c => c.telefone === alias), false);
    assert.equal(storage.listarContatosRecentes().some(c => c.telefone === alias), false);
    storage.dessilenciarContato(tel);
    storage.retomarAtendimento(tel);
    storage.vincularIdentidadeWhatsapp(alias, tel);
    assert.equal(storage.contatoSilenciado(tel), false, "vínculo repetido não desfaz reativação posterior");
    assert.equal(storage.obterSessao(tel).pausadaPeloDoutor, false);
    assert.throws(() => storage.vincularIdentidadeWhatsapp(alias, "+16195550123"), /divergente/);
    const outro = "lid:987654321012345";
    storage.salvarSessao(outro, { historico: [{ role: "user", content: "Conversa só no código interno" }] });
    storage.vincularIdentidadeWhatsapp(outro, "+16195550123");
    assert.equal(storage.obterSessao("+16195550123").historico.length, 1);

    const arquivo = path.join(temp, "data", "entradas.json");
    const novaMemoria = () => criarMemoriaMensagens({ arquivo, agora: () => agora });
    let memoria = novaMemoria();
    const msg = (id, jid = pn, texto = "Boa tarde! Tudo bem?", momento = agora) => ({
      key: { id, remoteJid: jid }, messageTimestamp: momento / 1000, message: { conversation: texto },
    });
    const primeira = msg("saudacao-original");
    assert.equal(memoria.iniciar(tel, primeira), "nova");
    assert.equal(memoria.iniciar(tel, primeira), "em_curso");
    memoria.concluir(tel, primeira);
    agora += 27 * 60000;
    memoria = novaMemoria(); // simula restart: nada do Map anterior sobrevive
    assert.equal(memoria.iniciar(tel, { ...primeira, key: { ...primeira.key, remoteJid: lid } }), "repetida");
    const oiNovo = msg("outro-id", lid);
    assert.equal(memoria.iniciar(tel, oiNovo, storage.obterSessao(tel)), "nova", "texto igual com novo horário é uma mensagem legítima");
    memoria.liberar(tel, oiNovo);
    assert.equal(novaMemoria().pendentes().length, 1, "falha preserva mensagem no disco");
    assert.equal(memoria.iniciar(tel, oiNovo), "nova", "erro não bloqueia nova tentativa");
    memoria.concluir(tel, oiNovo);
    assert.equal(memoria.iniciar(tel, msg("id-anterior-ao-deploy", lid, primeira.message.conversation, agora - 27 * 60000), storage.obterSessao(tel)), "antiga");
    assert.equal(memoria.pendentes().length, 0);
    const desconhecida = msg("aguarda-vinculo", "777777777777777@lid", "Preciso do horário");
    memoria.guardar(desconhecida);
    assert.equal(novaMemoria().pendentes()[0].message.conversation, "Preciso do horário");

    // Executa o handler real do servidor, com WhatsApp/IA falsos e relógio do debounce
    // controlado. Não abre porta, não conecta à rede nem envia mensagem para paciente.
    const fonte = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const timers = [], atendimentos = [], formatos = [];
    const fila = criarFilaPorChave();
    const ctx = vm.createContext({
      console: { log() {}, warn() {}, error(...v) { throw new Error(v.join(" ")); } },
      IdentidadeWhatsapp: Identidade, TextoDaMensagem: Texto,
      memoriaMensagens: memoria, Storage: storage, sock, sockAtivo: sock,
      geracao: 1, geracaoConexao: 1, encerrando: false,
      filaMensagens: fila, buffers: new Map(), DEBOUNCE_MS: 6000, LIMITE_TEXTO_ENTRADA: 8000,
      setTimeout: fn => { const t = { fn, cancelado: false }; timers.push(t); return t; },
      clearTimeout: t => { t.cancelado = true; },
      permitirMensagemDoTelefone: () => true, deveAvisarLimiteDeTaxa: () => true,
      normalizeMessageContent: Texto.desembrulhar,
      reenviarPendentesDoTelefone: async () => {},
      processarMensagem: async (_sock, _jid, telefone, texto) => { atendimentos.push({ telefone, texto }); },
      processarAudioRecebido: async () => { formatos.push("audio"); },
      processarFormatoNaoEntendido: async (_s, _j, _t, tipo) => { formatos.push(tipo); },
    });
    vm.runInContext(fonte.slice(fonte.indexOf("function concluirEntradas("), fonte.indexOf("function sessaoPadrao(")), ctx);
    const inicio = fonte.indexOf("  async function receberMensagens(");
    vm.runInContext(fonte.slice(inicio, fonte.indexOf('  sock.ev.on("messages.upsert"', inicio)), ctx);
    const receber = mensagens => ctx.receberMensagens({ messages: mensagens, type: "notify" });
    await receber([primeira]);
    assert.equal(timers.length, 0, "reentrega não chama IA nem arma debounce");
    await receber([msg("m1", pn, "uma"), msg("m2", lid, "duas"), msg("m3", pn, "três")]);
    for (const t of timers.splice(0)) if (!t.cancelado) t.fn();
    await fila.aguardarVazio();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(atendimentos, [{ telefone: tel, texto: "uma\nduas\ntrês" }]);
    await receber([msg("m1", lid, "uma")]);
    assert.equal(timers.length, 0);
    await receber([desconhecida]);
    assert.equal(storage.obterSessao("lid:777777777777777"), null, "LID sem vínculo não cria uma segunda família");
    mapa.set("777777777777777@lid", pn);
    await receber(memoria.pendentes());
    for (const t of timers.splice(0)) if (!t.cancelado) t.fn();
    await fila.aguardarVazio();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(atendimentos.at(-1).texto, "Preciso do horário");
    assert.equal(atendimentos.at(-1).telefone, tel);
    await receber([{ ...msg("audio"), message: { ephemeralMessage: { message: { audioMessage: {} } } } }, { ...msg("foto"), message: { imageMessage: {} } }]);
    await fila.aguardarVazio();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(formatos, ["audio", "midia"]);
    assert.equal(memoria.pendentes().length, 0);
    console.log("identidade-e-reentrega: passou (mapeamento, sessão, silêncio, reinício, replay e handler real)");
  } finally {
    if (storage) storage._fecharBancoAgendamentosParaTeste();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(erro => { console.error(erro); process.exitCode = 1; });
