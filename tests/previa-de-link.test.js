/*
 * Bateria da prévia de link.
 *
 * O quadro com título, imagem e descrição que aparece embaixo do link de pagamento é bonito e
 * faz diferença: a família recebe um endereço estranho pedindo R$ 550, e ver a logo da
 * InfinitePay ali é o que dá segurança pra clicar.
 *
 * O preço dele é que, pra montar esse quadro, o servidor da Carla SAI VISITANDO o endereço
 * que estiver escrito na mensagem, com um pacote (link-preview-js) que tem uma falha sem
 * correção: ele não se recusa a visitar endereços internos da própria máquina. Lá dentro tem
 * o painel com os dados dos pacientes e a API interna do bot.
 *
 * A defesa é uma linha só: só o link de pagamento, que é uma constante do código, pode
 * disparar a visita. Toda outra mensagem sai com linkPreview: null, e aí o Baileys nem chega
 * a olhar o que está escrito no texto. Assim não adianta convencer a Carla a escrever
 * "http://127.0.0.1:3355/..." numa resposta: aquela mensagem não tem o link de pagamento,
 * então vai com null.
 *
 * Essa bateria existe porque a defesa inteira mora numa comparação de string. Se alguém
 * trocar o link no prompt e esquecer deste arquivo, ou passar a mandar { text } cru em algum
 * envio novo, ela cai calada: nada quebra, nada dá erro, só volta a buscar tudo de novo.
 *
 * Roda com:  node tests/previa-de-link.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const Previa = require(path.join(__dirname, "..", "previa-de-link.js"));

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const RAIZ = path.join(__dirname, "..");
const SERVER = fs.readFileSync(path.join(RAIZ, "server.js"), "utf8");
const CEREBRO = fs.readFileSync(path.join(RAIZ, "cerebro-ia.js"), "utf8");
const LINK = Previa.LINK_DE_PAGAMENTO;

// ------------------------------------------------- 1. o link de pagamento pode buscar
{
  // undefined é o que faz o Baileys buscar. Não é "esqueci de preencher": é a decisão.
  eq(Previa.previaDeLink(`Aqui está o link para pagamento no cartão, em até 3x:\n\n${LINK}`), undefined,
    "1. mensagem com o link de pagamento deixa o Baileys buscar a prévia");
  eq(Previa.previaDeLink(LINK), undefined, "1b. o link sozinho também");
  eq(Previa.previaDeLink(`Segue: ${LINK} qualquer coisa me chama`), undefined, "1c. o link no meio do texto também");
}

// ------------------------------------------------- 2. todo o resto vai com null
{
  const casos = [
    ["Boa tarde 😊 Como posso ajudar você hoje?", "mensagem comum"],
    ["A chave Pix é o e-mail (R$ 550,00):\n\nbrunofransoares@gmail.com", "a mensagem do Pix, que não tem link"],
    ["", "texto vazio"],
  ];
  for (const [texto, o_que] of casos) eq(Previa.previaDeLink(texto), null, "2. " + o_que + " sai com null");

  eq(Previa.previaDeLink(null), null, "2b. texto nulo sai com null, sem quebrar");
  eq(Previa.previaDeLink(undefined), null, "2c. texto indefinido sai com null, sem quebrar");
}

// ------------------------------------------------- 3. endereço interno nunca dispara busca
{
  // O ataque que isso fecha: convencer a Carla a escrever um endereço da própria máquina numa
  // resposta. Todos estes precisam sair com null, inclusive os que vêm junto de conversa
  // normal, porque é assim que um pedido desses chegaria de verdade.
  const ataques = [
    "http://127.0.0.1:3355/api/agendamentos",
    "http://localhost:3357/interno/pagamento-confirmado",
    "http://[::1]:3355/",
    "http://0.0.0.0:3355/",
    "http://169.254.169.254/latest/meta-data/",
    "Claro! http://127.0.0.1:3355/api/agendamentos é isso que você pediu 😊",
    "https://link.infinitepay.io.exemplo.com/roubado",
    "https://link.infinitepay.io/brunoffsoares/OUTRO-LINK-QUALQUER-550,00",
  ];
  for (const a of ataques) eq(Previa.previaDeLink(a), null, "3. NÃO pode buscar: " + a);
}

// ------------------------------------------------- 4. o conteúdo montado carrega os dois campos
{
  const comLink = Previa.mensagemDeTexto(`Segue o link: ${LINK}`);
  eq(comLink.text, `Segue o link: ${LINK}`, "4. o texto passa inteiro");
  ok("linkPreview" in comLink, "4b. o campo linkPreview sempre existe no conteúdo");
  eq(comLink.linkPreview, undefined, "4c. com o link de pagamento, linkPreview fica undefined");

  const semLink = Previa.mensagemDeTexto("Boa tarde 😊");
  eq(semLink.text, "Boa tarde 😊", "4d. o texto passa inteiro");
  eq(semLink.linkPreview, null, "4e. sem o link de pagamento, linkPreview fica null");
}

// ------------------------------------------------- 5. o link é o mesmo do prompt
{
  // A defesa é uma comparação de string. Se o link mudar no prompt e não aqui, a Carla passa
  // a mandar um link que nunca casa, a prévia some, e ninguém descobre porque nada quebra.
  ok(CEREBRO.includes(LINK), "5. o link deste arquivo tem que estar escrito no prompt da Carla");

  const noPrompt = CEREBRO.match(/https:\/\/link\.infinitepay\.io\/[^\s`"]*[^\s`".]/g) || [];
  ok(noPrompt.length > 0, "5b. o prompt tem pelo menos um link da InfinitePay");
  const diferentes = [...new Set(noPrompt)].filter((l) => l !== LINK);
  eq(diferentes.length, 0, "5c. o prompt não pode ter um link de pagamento diferente deste. Diferentes: " + JSON.stringify(diferentes));
}

// ------------------------------------------------- 6. nenhum envio escapa da decisão
{
  // Um sendMessage novo escrito com { text: ... } cru volta ao undefined por descuido, e aí
  // aquela mensagem passa a poder buscar qualquer endereço de novo. Não pode existir nenhum.
  const cru = SERVER.match(/sendMessage\([^)]*\{\s*text:/g) || [];
  eq(cru.length, 0, "6. nenhum sendMessage pode montar { text: ... } na mão. Achei: " + JSON.stringify(cru));

  // A rede agora fica centralizada na caixa de saída. O servidor injeta a função da prévia
  // uma vez, e nenhum fluxo individual chama sendMessage por conta própria.
  const CAIXA = fs.readFileSync(path.join(RAIZ, "caixa-de-saida.js"), "utf8");
  ok(!SERVER.includes(".sendMessage(")
    && /sendMessage\(atual\.jid, prepararMensagem\(atual\.texto\)\)/.test(CAIXA)
    && /prepararMensagem: Previa\.mensagemDeTexto/.test(SERVER),
  "6b. o único envio de rede passa pela decisão central de prévia");
  ok(/require\(path\.join\(__dirname, "previa-de-link\.js"\)\)/.test(SERVER), "6c. o server importa o módulo da prévia");
}

console.log(`\nprevia-de-link: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
