/*
 * Bateria do reaquecimento de lead.
 *
 * O DONO (2026-10-01): "O botão de reaquecer tem que estar disponível em todo o contato. Eu
 * decido o tempo, entendeu? Não é para o botão de reaquecer aparecer só depois de certo
 * tempo. E na mensagem sugerida, o botão deve levar a conversa em consideração ali e
 * responder direito."
 *
 * Então: o botão está em toda ficha, o clique só SUGERE (a Carla escreve com a conversa à
 * vista, num pedido sem ferramentas), a sugestão cai na caixa de mensagem, e quem envia é ele.
 * O que antes eram travas (conversa de hoje, já reaquecido, nunca respondeu, consulta
 * marcada) virou aviso ao lado da sugestão.
 *
 * O que continua de pé: um contato por vez, nunca em lote. A Carla roda num cliente não
 * oficial do WhatsApp, e disparo em massa é o padrão clássico de banimento.
 *
 * Roda com:  node tests/reaquecer-lead.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (typeof msg !== "string") throw new Error("ok(cond, msg)"); if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const RAIZ = path.join(__dirname, "..");
const Reaquecimento = require(path.join(RAIZ, "reaquecimento.js"));
const SERVER = fs.readFileSync(path.join(RAIZ, "server.js"), "utf8");
const PAINEL = fs.readFileSync(path.join(RAIZ, "painel-server.js"), "utf8");
const TELA = fs.readFileSync(path.join(RAIZ, "dashboard.html"), "utf8");
const CEREBRO = fs.readFileSync(path.join(RAIZ, "cerebro-ia.js"), "utf8");

const AGORA = new Date("2026-08-20T12:00:00Z");
const HA_TRES_DIAS = new Date("2026-08-17T12:00:00Z").toISOString();
const HA_DUAS_HORAS = new Date("2026-08-20T10:00:00Z").toISOString();
const OK = { respondeuAlgumaVez: true, ultimaAtividade: HA_TRES_DIAS };

// ------------------------------------------------- 1. ele decide: nada é recusado
{
  const v = Reaquecimento.podeReaquecer(OK, AGORA);
  ok(v.pode && v.avisos.length === 0, "1. lead que respondeu e sumiu há 3 dias: pode, sem aviso");
  const casos = [
    [{ silenciado: true }, /silenciado/i, "1b. número silenciado"],
    [{ aguardandoHumano: true }, /esperando você/i, "1c. conversa esperando ele"],
    [{ temConsultaFutura: true }, /consulta marcada/i, "1d. quem já tem consulta"],
    [{ jaReaquecidoEm: HA_TRES_DIAS }, /Já foi reaquecido/, "1e. quem já foi reaquecido"],
    [{ ultimaAtividade: HA_DUAS_HORAS }, /menos de um dia/, "1f. conversa de hoje"],
    [{ respondeuAlgumaVez: false }, /nunca respondeu[\s\S]*denunciado/, "1g. quem nunca respondeu, com o risco explicado"],
  ];
  for (const [extra, regex, nome] of casos) {
    const r = Reaquecimento.podeReaquecer({ ...OK, ...extra }, AGORA);
    ok(r.pode, `${nome}: o botão funciona mesmo assim, quem decide é ele`);
    ok(r.avisos.some((a) => regex.test(a)), `${nome}: e aparece como aviso (veio ${JSON.stringify(r.avisos)})`);
  }
}

// ------------------------------------------------- 2. a conversa entra na sugestão
{
  const historico = [
    { role: "user", content: "Oi, quanto custa a consulta?" },
    { role: "assistant", content: [{ type: "text", text: "A consulta de puericultura é R$ 600." }, { type: "tool_use", id: "x", name: "y", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "segredo da ferramenta" }] },
    null,
    { role: "system", content: "nota interna que não é fala de ninguém" },
    { role: "user", content: "Vocês atendem sábado?" },
  ];
  const t = Reaquecimento.trechoDaConversa(historico);
  ok(/Família: Oi, quanto custa a consulta\?/.test(t), "2. a fala da família entra");
  ok(/Carla: A consulta de puericultura é R\$ 600\./.test(t), "2b. e a da Carla, mesmo quando veio junto com ferramenta");
  ok(!/nota interna/.test(t), "2c0. só fala da família e da Carla entra; outro papel não vira 'Carla:'");
  ok(!/segredo da ferramenta/.test(t), "2c. resultado de ferramenta não entra: não é conversa");
  ok(/Família: Vocês atendem sábado\?$/.test(t), "2d. e a última pergunta sem resposta fica por último, que é o que a sugestão precisa ver");
  const longa = Array.from({ length: 40 }, (_, i) => ({ role: "user", content: "fala " + i }));
  const corte = Reaquecimento.trechoDaConversa(longa).split("\n");
  ok(corte.length === 20 && corte[19] === "Família: fala 39", "2e. conversa longa: ficam as 20 últimas falas");

  const pedido = Reaquecimento.montarPedidoDaSugestao({ fatos: "Esta família falou com você há 3 dias.", conversa: t });
  ok(pedido.includes(t) && /há 3 dias/.test(pedido), "2f. o pedido leva os fatos E a conversa");
  ok(/não há conversa guardada/.test(Reaquecimento.montarPedidoDaSugestao({ fatos: "x" })), "2g. sem conversa, diz isso em vez de mandar vazio");

  const i = Reaquecimento.montarInstrucaoDaSugestao();
  ok(/Leve a conversa em conta/.test(i) && /pergunta da família sem resposta, responda direito/.test(i),
    "2h. a instrução manda responder o que ficou pendente");
  ok(/NUNCA invente valor, horário, endereço/.test(i), "2i. sem inventar o que não está na conversa");
  ok(/Deixe fácil dizer que não/.test(i), "2j. com saída fácil, que é o que evita denúncia");
  ok(!/—/.test(i + pedido), "2k. sem travessão no que vai pro modelo");
  eq(Reaquecimento.limparSugestao("\"Oi — tudo bem?\""), "Oi, tudo bem?", "2l. travessão e aspas da resposta saem antes de chegar à caixa");
}

// ------------------------------------------------- 3. a sugestão não faz nada sozinha
{
  const sugestao = CEREBRO.slice(CEREBRO.indexOf("async function sugerirReaquecimento("), CEREBRO.indexOf("module.exports = {"));
  ok(sugestao.length > 0, "3. a chamada da sugestão existe");
  ok(!/tools:/.test(sugestao), "3b. SEM ferramentas: não marca, não cancela, não consulta agenda");
  ok(/model: MODELO/.test(sugestao), "3c. mesmo modelo da conversa");
  const noBot = SERVER.slice(SERVER.indexOf("async function sugerirReaquecimento("), SERVER.indexOf("// MENSAGEM DO DR. BRUNO PRA FAMÍLIA"));
  ok(noBot.length > 0 && !/enviarResposta\(|salvarSessao\(|Eventos\.registrar\(/.test(noBot),
    "3d. e o bot não envia, não grava sessão nem conta no funil ao sugerir");
  ok(/trechoDaConversa\(historico\)/.test(noBot), "3e. a conversa guardada vai junto");
  ok(/avisos: veredito\.avisos/.test(noBot), "3f. e os avisos voltam pro painel");
  ok(/const r = await sugerirReaquecimento\(dados\.telefone\);/.test(SERVER), "3g. a rota /interno/reaquecer agora sugere");
}

// ------------------------------------------------- 4. quem envia é ele, pela mensagem manual
{
  const bloco = SERVER.slice(SERVER.indexOf("async function mensagemManualNaFila"), SERVER.indexOf("async function processarMensagem"));
  ok(/if \(reaquecimento\) sessao\.reaquecidoEm = agora\.toISOString\(\);/.test(bloco), "4. o envio marca o contato como reaquecido");
  ok(/Eventos\.registrar\(reaquecimento \? "reaquecido" : "mensagem_manual"/.test(bloco), "4b. e o funil conta como reaquecimento");
  ok(/caixa\.querySelector\("\.input-carla-continua"\)\.checked = true;/.test(TELA), "4c. com a Carla continuando se a pessoa responder");
}

// ------------------------------------------------- 5. a tela: o botão em toda ficha, e ele só preenche a caixa
{
  ok(!/podeMostrarReaquecer/.test(TELA), "5. não existe mais regra escondendo o botão");
  ok(/<button class="btn-reaquecer-contato" data-telefone="\$\{escapeHtml\(c\.telefone\)\}"/.test(TELA), "5b. o botão está na ficha de todo contato");

  const ini = TELA.indexOf("  async function reaquecerContato(botao, telefone) {");
  const fim = TELA.indexOf("\n  }\n", ini) + 4;
  const fonte = TELA.slice(ini, fim);
  ok(!/mensagem-manual|confirm\(/.test(fonte), "5c. o clique não envia nada");

  const campo = { value: "", focus() {} };
  const aviso = { textContent: "" };
  const continua = { checked: false };
  const caixa = { hidden: true, dataset: {}, querySelector: (s) => (s === "textarea" ? campo : s === ".msg-manual-aviso" ? aviso : continua) };
  const pedidos = [];
  const sandbox = {
    postJSON: async (rota, corpo) => { pedidos.push({ rota, corpo }); return { json: async () => ({ ok: true, texto: "Oi Ana! Sobre o sábado: ...", avisos: ["Já tem consulta marcada."] }) }; },
    document: { querySelector: () => caixa }, CSS: { escape: (s) => s }, alert: () => { throw new Error("não devia avisar"); },
  };
  vm.createContext(sandbox);
  vm.runInContext(fonte + "\nthis.f = reaquecerContato;", sandbox);
  const botao = { disabled: false, textContent: "Reaquecer" };
  return_ = sandbox.f(botao, "+5531999990000").then(() => {
    eq(pedidos.length, 1, "5d. pede uma sugestão");
    eq(pedidos[0] && pedidos[0].rota, "/api/reaquecer", "5e. pela rota do reaquecer");
    eq(campo.value, "Oi Ana! Sobre o sábado: ...", "5f. e a sugestão cai na caixa");
    ok(!caixa.hidden && caixa.dataset.reaquecimento === "1" && continua.checked, "5g. caixa aberta, marcada como reaquecimento e com a Carla continuando");
    ok(/leia, ajuste/.test(aviso.textContent) && /Já tem consulta marcada/.test(aviso.textContent), "5h. com o aviso pra ele decidir");
    ok(!botao.disabled && botao.textContent === "Reaquecer", "5i. e o botão volta a funcionar (pode pedir outra)");
  });
}
var return_;

// ------------------------------------------------- 6. nunca em lote
{
  ok(/NÃO existe versão em lote aqui, de propósito/.test(PAINEL), "6. a ausência de lote está documentada como decisão");
  ok(!/reaquecer-todos|reaquecerTodos|reaquecer-lote/.test(PAINEL + SERVER + TELA), "6b. e não existe rota nem botão de lote");
  ok(/encaminharAoBot\("\/interno\/reaquecer"/.test(PAINEL), "6c. o painel encaminha pro bot");
}

// ------------------------------------------------- 7. o que já funcionava não mudou
{
  ok(/RECADO DO DR\. BRUNO/.test(CEREBRO), "7. o recado do Dr. Bruno continua");
  ok(/historicoExpirou\(sessao, now\)/.test(SERVER), "7b. a limpeza das 4h continua de pé");
}

return_.then(() => {
  console.log(`\nreaquecer-lead: ${passou} passaram, ${falhou} falharam`);
  if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
}).catch((e) => { console.error(e); process.exit(1); });
