/**
 * Auditoria de 10/09, problemas 4 e 5: a ficha podia mostrar outra família.
 *
 * 4 (servidor): a rota filtrava contatos, agendamentos e funil pelo telefone pedido, mas
 * entregava o arquivo INTEIRO de consultas manuais. montarCrm cria família a partir de
 * consulta manual, então outras famílias entravam na lista, a lista é ordenada por urgência
 * e atividade, e a rota devolvia a PRIMEIRA. Pedir B e receber A.
 *
 * 5 (tela): abrir A, abrir B, e a resposta de A chegar depois desenhava A por cima de B.
 */
"use strict";
const fs = require("fs");
const path = require("path");
let passou = 0, falhou = 0; const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const Crm = require(path.join(__dirname, "..", "crm.js"));
const PAINEL = fs.readFileSync(path.join(__dirname, "..", "painel-server.js"), "utf8");
const TELA = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");
const AGORA = new Date(2026, 8, 10, 12, 0, 0);

// O arquivo do CRM como ele fica depois de umas semanas de uso: várias famílias.
const ARQUIVO = {
  notas: { "+A": [{ id: "n1", texto: "nota da A", em: "2026-09-01T10:00:00Z" }], "+B": [{ id: "n2", texto: "nota da B", em: "2026-09-02T10:00:00Z" }] },
  etiquetas: { "+A": ["TEA"], "+B": ["fono"] },
  consultasRealizadas: {
    "+A": [{ id: "c1", data: "2026-09-09", crianca: "Ana", tipoConsulta: "puericultura", em: "2026-09-09T12:00:00Z" }],
    "+B": [{ id: "c2", data: "2026-06-20", crianca: "Bruno", tipoConsulta: "puericultura", em: "2026-06-20T12:00:00Z" }],
  },
  retornos: { "+A": {}, "+B": {} },
};

// ------------------------------------------------- 1. o recorte por telefone, executado
{
  const soB = Crm.recortarCrmDoTelefone(ARQUIVO, "+B");
  eq(Object.keys(soB.consultasRealizadas).join(","), "+B", "1. só as consultas manuais da família pedida");
  eq(Object.keys(soB.notas).join(",") + "|" + Object.keys(soB.etiquetas).join(",") + "|" + Object.keys(soB.retornos).join(","), "+B|+B|+B", "1b. e o mesmo pras notas, etiquetas e retornos");
  eq(soB.consultasRealizadas["+B"][0].crianca, "Bruno", "1c. com o conteúdo intacto");
  const semNada = Crm.recortarCrmDoTelefone(ARQUIVO, "+Z");
  eq(JSON.stringify(semNada), JSON.stringify({ notas: {}, etiquetas: {}, consultasRealizadas: {}, retornos: {} }), "1d. quem não tem nada guardado recebe o recorte vazio, não o arquivo");
  eq(JSON.stringify(Crm.recortarCrmDoTelefone(null, "+B")), JSON.stringify({ notas: {}, etiquetas: {}, consultasRealizadas: {}, retornos: {} }), "1e. e sem arquivo nenhum não quebra");
}

// ------------------------------------------------- 2. a ficha certa, com o bug e sem ele
{
  // A família B não tem conversa nenhuma: só a consulta registrada à mão. É o caso da
  // auditoria. A A tem atividade recente, então a ordenação a coloca na frente.
  const contatosDeB = [];
  const montar = (dados) => Crm.montarCrm({ contatos: contatosDeB, agendamentos: [], funilContatos: [], dadosCrm: dados, agora: AGORA });

  const comArquivoInteiro = montar(ARQUIVO);
  ok(comArquivoInteiro.contatos.length > 1, "2. com o arquivo inteiro, a lista da ficha de B tem mais de uma família (era daqui que vinha o erro)");
  ok(comArquivoInteiro.contatos[0].telefone !== "+B", "2b. e a primeira posição não é a família pedida: pegar [0] devolvia a outra");
  eq(comArquivoInteiro.contatos.find((c) => c.telefone === "+B") ? "achou" : "sumiu", "achou", "2c. escolher por telefone acha a certa mesmo na lista suja");

  const comRecorte = montar(Crm.recortarCrmDoTelefone(ARQUIVO, "+B"));
  eq(comRecorte.contatos.length, 1, "2d. com o recorte, só a família pedida existe na lista");
  eq(comRecorte.contatos[0].telefone, "+B", "2e. e é ela");
  eq(comRecorte.contatos[0].ultimaConsulta.crianca, "Bruno", "2f. com a consulta dela, não a da outra");
}

// ------------------------------------------------- 3. a rota usa as duas travas
{
  const rota = PAINEL.slice(PAINEL.indexOf('caminhoPedido === "/api/crm/contato"'), PAINEL.indexOf('caminhoPedido === "/api/crm/nota"'));
  ok(/dadosCrm: Crm\.recortarCrmDoTelefone\(dadosCrm, telefone\),/.test(rota), "3. a rota recorta o arquivo do CRM no telefone pedido");
  ok(/const contato = crm\.contatos\.find\(\(c\) => c\.telefone === telefone\) \|\| null;/.test(rota), "3b. e escolhe por igualdade de telefone, nunca por [0]");
  ok(!/crm\.contatos\[0\]/.test(rota), "3c. a primeira posição não é mais usada");
  ok(/contatos: Storage\.listarTodosContatos\(\)\.filter\(\(c\) => c\.telefone === telefone\)/.test(rota) && /agendamentos: Storage\.lerTodosAgendamentos\(\)\.filter\(\(a\) => a\.telefone === telefone\)/.test(rota) && /funilContatos: Eventos\.funil\(\{\}\)\.contatos\.filter\(\(c\) => c\.telefone === telefone\)/.test(rota), "3d. e os outros três continuam filtrados");
  ok(/ok: true,\s*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*telefone,/.test(rota), "3e. a resposta diz de qual telefone ela é, pra tela poder conferir");
}

// ------------------------------------------------- 4. a tela descarta resposta que chegou tarde
{
  const fn = TELA.slice(TELA.indexOf("let pedidoDaFicha = 0;"), TELA.indexOf("function renderizarFicha(f)"));
  ok(/const meuPedido = \+\+pedidoDaFicha;/.test(fn) && /const telefonePedido = telefoneAberto;/.test(fn), "4. cada carregamento tem número e guarda de quem ele é");
  ok(/if \(meuPedido !== pedidoDaFicha \|\| telefonePedido !== telefoneAberto\) return;/.test(fn), "4b. resposta de um pedido antigo, ou de família que não está mais aberta, é descartada");
  ok(/if \(f\.ok && f\.telefone !== telefonePedido\) return;/.test(fn), "4c. e a resposta ainda precisa dizer que é do telefone pedido");
  const posGuarda = fn.indexOf("if (meuPedido !== pedidoDaFicha");
  const posRender = fn.indexOf("renderizarFicha(f);");
  const posAtual = fn.indexOf("fichaAtual = f;");
  ok(posGuarda > 0 && posAtual > posGuarda && posRender > posGuarda, "4d. as conferências vêm ANTES de guardar e desenhar: fichaAtual é o que os botões usam");
  ok(/`\/api\/crm\/contato\?telefone=\$\{encodeURIComponent\(telefonePedido\)\}`/.test(fn), "4e. o pedido vai com o telefone guardado, não com o que estiver aberto quando a linha rodar");
}

// ------------------------------------------------- 5. a lista geral continua inteira
{
  const rotaLista = PAINEL.slice(PAINEL.indexOf('caminhoPedido === "/api/crm" && req.method === "GET"'), PAINEL.indexOf('caminhoPedido === "/api/crm/contato"'));
  ok(/dadosCrm: Crm\.lerCrm\(ARQ_CRM\),/.test(rotaLista) && !/recortarCrmDoTelefone/.test(rotaLista), "5. a aba Famílias continua recebendo o arquivo inteiro: lá o recorte seria o erro");
}

console.log(`\nficha-da-familia-certa: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
