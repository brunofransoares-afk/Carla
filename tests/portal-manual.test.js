"use strict";
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Avisos = require("../avisos-texto.js");
const Crm = require("../crm.js");
const { criarAvisadorPortalManual } = require("../portal-manual.js");
const { criarFilaPorChave } = require("../fila-por-chave.js");
const { criarCaixaDeSaida } = require("../caixa-de-saida.js");

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "carla-portal-manual-"));
  let storage;
  try {
    for (const nome of ["storage-node.js", "arquivo-atomico.js", "grade-teleconsulta.js"]) fs.copyFileSync(path.join(__dirname, "..", nome), path.join(temp, nome));
    fs.cpSync(path.join(__dirname, "..", "carla-app"), path.join(temp, "carla-app"), { recursive: true });
    storage = require(path.join(temp, "storage-node.js"));
    const tel = "+16195550123", segundo = "+5519000000002";
    const endereco = "https://portal.example.test/familia";
    const dados = { telefone: tel, email: "mae@example.test", acessoLiberado: true };
    storage.registrarContatoWhatsapp(tel, { pushName: "Família externa fictícia" });
    storage.salvarSessao(tel, { historico: [], pausadaPeloDoutor: true });
    storage.silenciarContato(tel);
    const preparado = Avisos.prepararPortalManual({ ...dados, endereco });
    assert.equal(preparado.ok, true);
    assert.match(preparado.texto, /portal da sua família/);
    assert.match(preparado.texto, /mae@example.test/);
    assert.doesNotMatch(preparado.texto, /undefined|null/);
    for (const email of ["", "   ", "sem-arroba", "a@b", "a@b.com\nlink-malicioso", "<a>@b.com"]) {
      assert.equal(Avisos.prepararPortalManual({ ...dados, endereco, email }).ok, false);
    }
    for (const url of ["", "javascript:alert(1)", "http://exemplo.test", "https://user:senha@exemplo.test"]) {
      assert.equal(Avisos.prepararPortalManual({ ...dados, endereco: url }).ok, false);
    }
    assert.equal(Avisos.prepararPortalManual({ ...dados, endereco, acessoLiberado: "true" }).ok, false);
    assert.equal(Avisos.prepararPortalManual({ ...dados, endereco, telefone: "lid:1234" }).ok, false);
    assert.equal(Avisos.prepararPortalManual({ ...dados, endereco, email: "  corrigido@example.test  " }).email, "corrigido@example.test");

    let redeDisponivel = false, envios = 0, chamadas = 0;
    const fila = criarFilaPorChave();
    const sock = { sendMessage: async () => { if (!redeDisponivel) throw new Error("offline de teste"); envios++; } };
    const fonteBot = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const efeitoFonte = fonteBot.slice(fonteBot.indexOf("function aplicarEfeitoAposEnvio("), fonteBot.indexOf("const caixaDeSaida ="));
    const aplicarEfeito = new Function("Storage", efeitoFonte + "\nreturn aplicarEfeitoAposEnvio;")(storage);
    const caixa = criarCaixaDeSaida({ storage, prepararMensagem: texto => ({ text: texto }), aplicarEfeito, logger: { log() {}, error() {} } });
    const construir = () => criarAvisadorPortalManual({
      storage, fila, endereco: () => endereco,
      contatoExiste: t => t === tel || t === segundo,
      enviar: async (telefone, texto, opcoes) => {
        chamadas++;
        const p = storage.registrarMensagemPendente({ telefone, jid: telefone.slice(1) + "@s.whatsapp.net", texto, ...opcoes });
        try { await caixa.tentarEnviar(sock, p); return { ok: true }; }
        catch { return { ok: true, pendente: true }; }
      },
    });
    let avisar = construir();
    assert.equal((await avisar({ ...dados, telefone: "+5519000000999" })).ok, false);
    const duplicadas = await Promise.all([avisar(dados), avisar(dados), avisar(dados)]);
    assert(duplicadas.every(r => r.ok && r.pendente));
    assert.equal(chamadas, 1, "três cliques deixam só uma mensagem durável");
    assert.equal(storage.listarMensagensPendentes(tel).length, 1);
    assert.equal(storage.lerTodosAgendamentos().length, 0, "envio não fabrica uma reserva");
    const pendente = storage.listarMensagensPendentes(tel)[0];
    assert.equal(storage.portalManualAvisado(tel, pendente.chaveIdempotencia), false, "offline não marca entregue");
    redeDisponivel = true;
    await fila.enfileirar(tel, () => caixa.reenviarDoTelefone(sock, tel));
    assert.equal(envios, 1);
    assert.equal(storage.listarMensagensPendentes(tel).length, 0);
    assert.equal(storage.portalManualAvisado(tel, pendente.chaveIdempotencia), true);
    avisar = construir();
    assert.equal((await avisar(dados)).jaAvisado, true, "marca durável impede repetição após reiniciar");
    assert.equal((await avisar({ ...dados, email: "MAE@example.test" })).jaAvisado, true);
    assert.equal((await avisar({ ...dados, email: "corrigido@example.test" })).ok, true);
    assert.equal(envios, 2, "endereço corrigido permite novo aviso explícito");
    assert.equal(storage.contatoSilenciado(tel), true);
    assert.equal(storage.obterSessao(tel).pausadaPeloDoutor, true);

    // Executa a rota GET real sobre uma consulta registrada por fora, sem reserva Carla.
    const arqCrm = path.join(temp, "data", "crm.json");
    Crm.registrarConsultaRealizada(arqCrm, tel, { data: "2026-09-10", crianca: "Criança fictícia" }, new Date("2026-09-14T15:00:00Z"));
    storage.guardarDadosPendentes(tel, { email: "informado@example.test" });
    storage.registrarContatoWhatsapp(segundo, { pushName: "Outra família fictícia" });
    storage.guardarDadosPendentes(segundo, { email: "outra@example.test" });
    const fontePainel = fs.readFileSync(path.join(__dirname, "..", "painel-server.js"), "utf8");
    const tela = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");
    assert.match(tela, /data-portal-manual-atalho/);
    assert.match(tela, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
    assert.match(tela, /Mensagem do portal<small>editar e enviar<\/small>/);
    const inicioGet = fontePainel.indexOf('  if (caminhoPedido === "/api/crm/contato"');
    const fimGet = fontePainel.indexOf('  if (caminhoPedido === "/api/crm/nota"', inicioGet);
    let status, corpo;
    const res = { writeHead: s => { status = s; }, end: s => { corpo = JSON.parse(s); } };
    const get = new Function("req", "res", "Storage", "Crm", "Avisos", "Eventos", "ARQ_CRM", "process", "LINK_AVALIACAO", "const caminhoPedido = '/api/crm/contato';\n" + fontePainel.slice(inicioGet, fimGet));
    get({ method: "GET", url: "/api/crm/contato?telefone=" + encodeURIComponent(tel) }, res, storage, Crm, Avisos,
      { funil: () => ({ contatos: [] }), lerEventos: () => [] }, arqCrm, { env: { PORTAL_URL: endereco } }, "");
    assert.equal(status, 200);
    assert.equal(corpo.consultas[0].estado, "realizada");
    assert.equal(corpo.portal.emailSugerido, "informado@example.test");
    assert.equal(corpo.portal.disponivel, true);
    assert.match(corpo.portal.modelo, /\{\{EMAIL_RESPONSAVEL\}\}/);
    assert.doesNotMatch(JSON.stringify(corpo), /outra@example.test/);

    // A rota manual encaminha exatamente o telefone e o e-mail revistos, sob as mesmas
    // verificações de sessão e origem de todas as demais ações do painel.
    const inicioPost = fontePainel.indexOf('  if (req.url === "/api/portal-manual"');
    const fimPost = fontePainel.indexOf('  if (req.url === "/api/avisar-portal"', inicioPost);
    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
    const post = new AsyncFunction("req", "res", "lerCorpoJSON", "encaminharAoBot", fontePainel.slice(inicioPost, fimPost));
    let encaminhado;
    await post({ method: "POST", url: "/api/portal-manual" }, res, async () => ({ ...dados, texto: "não aceitar texto arbitrário" }), async (url, json) => {
      encaminhado = { url, dados: JSON.parse(json) };
      return { status: 200, texto: JSON.stringify({ ok: true, pendente: true }) };
    });
    assert.deepEqual(encaminhado, { url: "/interno/portal-manual", dados });
    assert.equal(corpo.pendente, true);
    assert(fontePainel.indexOf("if (!autenticacao.ok)") < inicioPost);
    assert(fontePainel.indexOf("Seguranca.origemPermitida") >= 0 && fontePainel.indexOf("Seguranca.origemPermitida") < inicioPost);
    console.log("portal-manual: passou (validação, consulta externa, rotas, clique duplo, offline e entrega)");
  } finally {
    if (storage) storage._fecharBancoAgendamentosParaTeste();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(erro => { console.error(erro); process.exitCode = 1; });
