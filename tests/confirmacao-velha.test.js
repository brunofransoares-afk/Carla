/*
 * Bateria: confirmação de pagamento antiga não sai mais, e o painel mostra a versão que roda.
 *
 * O dono, depois de a mensagem do botão Pago ter sido retirada: "eu apertei o botão e mandou
 * para a paciente a mensagem. Não era para ter mandado."
 *
 * O código novo não gera mais a mensagem. Sobram dois jeitos de ela sair: uma confirmação
 * gerada antes, parada na caixa de saída (que reenvia tudo a cada reconexão e a cada
 * mensagem nova da família), e um processo que não reiniciou e roda o código velho. O
 * primeiro é fechado aqui; o segundo fica visível no painel.
 *
 * Roda com:  node tests/confirmacao-velha.test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

let passou = 0;
const erros = [];
function ok(cond, nome) { if (typeof nome !== "string") throw new Error("ok(cond, nome)"); if (cond) passou++; else erros.push(nome); }

const RAIZ = path.join(__dirname, "..");
const SERVER = fs.readFileSync(path.join(RAIZ, "server.js"), "utf8");
const TELA = fs.readFileSync(path.join(RAIZ, "dashboard.html"), "utf8");
const PAINEL = fs.readFileSync(path.join(RAIZ, "painel-server.js"), "utf8");

// ------------------------------------------------- 1. a limpeza, executada de verdade
{
  const ini = SERVER.indexOf("function descartarConfirmacoesDePagamentoPendentes(");
  const fim = SERVER.indexOf("\n}\n", ini) + 3;
  const fonte = SERVER.slice(ini, fim);
  let fila = [
    { telefone: "+551", chaveIdempotencia: "pagamento:s1" },
    { telefone: "+551", chaveIdempotencia: "lembrete:semanaAntes:s1" },
    { telefone: "+552", chaveIdempotencia: "pagamento:s2" },
    { telefone: "+552", chaveIdempotencia: "manual:+552:1" },
  ];
  const Storage = {
    listarMensagensPendentes: (tel) => (tel ? fila.filter((m) => m.telefone === tel) : fila.slice()),
    removerMensagemPendentePorChave: (c) => { const a = fila.length; fila = fila.filter((m) => m.chaveIdempotencia !== c); return fila.length !== a; },
  };
  const sb = { Storage, console: { log() {} } };
  vm.createContext(sb);
  vm.runInContext(fonte + "\nthis.f = descartarConfirmacoesDePagamentoPendentes;", sb);

  ok(sb.f("+551") === 1, "1. descarta a confirmação daquele telefone");
  ok(fila.some((m) => m.chaveIdempotencia === "pagamento:s2"), "1b. sem mexer na de outro telefone quando o pedido é de um só");
  ok(fila.some((m) => m.chaveIdempotencia === "lembrete:semanaAntes:s1"), "1c. lembrete pendente continua: só a confirmação sai");
  ok(sb.f() === 1 && !fila.some((m) => /^pagamento:/.test(m.chaveIdempotencia)), "1d. sem telefone, varre a caixa toda");
  ok(fila.some((m) => m.chaveIdempotencia === "manual:+552:1"), "1e. mensagem escrita por ele continua na fila");
}

// ------------------------------------------------- 2. ela roda ANTES de qualquer reenvio
{
  const umTel = SERVER.slice(SERVER.indexOf("async function reenviarPendentesDoTelefone("), SERVER.indexOf("async function reenviarMensagensPendentes("));
  const pDesc = umTel.indexOf("descartarConfirmacoesDePagamentoPendentes(telefone)");
  const pEnvio = umTel.indexOf("caixaDeSaida.reenviarDoTelefone(");
  ok(pDesc > 0 && pEnvio > pDesc, "2. no reenvio de um telefone (a cada mensagem nova da família), limpa antes de reenviar");

  const todos = SERVER.slice(SERVER.indexOf("async function reenviarMensagensPendentes("), SERVER.indexOf("async function reconciliarPagamentosSemAviso("));
  const pD = todos.indexOf("descartarConfirmacoesDePagamentoPendentes()");
  const pL = todos.indexOf("Storage.listarMensagensPendentes()");
  ok(pD > 0 && pL > pD, "2b. na reconexão, limpa antes de montar a lista de reenvio");

  const botao = SERVER.slice(SERVER.indexOf("async function avisarPagamentoConfirmadoNaFila("), SERVER.indexOf("async function avisarPortalManual("));
  ok(/descartarConfirmacoesDePagamentoPendentes\(a\.telefone\)/.test(botao), "2c. e o próprio botão Pago limpa o que houver daquela família");
  ok(!/enviarResposta\(/.test(botao), "2d. e continua sem enviar nada");
  ok(!/Pagamento recebido/.test(SERVER), "2e. o texto da confirmação não existe mais no bot");
}

// ------------------------------------------------- 3. a versão aparece
{
  const { lerCommit } = require(path.join(RAIZ, "versao-do-codigo.js"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "versao-"));
  fs.mkdirSync(path.join(tmp, ".git", "refs", "heads"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".git", "HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(path.join(tmp, ".git", "refs", "heads", "main"), "abcdef1234567890abcdef1234567890abcdef12\n");
  ok(lerCommit(tmp) === "abcdef1", "3. lê o commit pela referência do branch");
  fs.rmSync(path.join(tmp, ".git", "refs", "heads", "main"));
  fs.writeFileSync(path.join(tmp, ".git", "packed-refs"), "# pack\n1234567890abcdef1234567890abcdef12345678 refs/heads/main\n");
  ok(lerCommit(tmp) === "1234567", "3b. e pelo packed-refs, que é como o git guarda depois de um gc");
  ok(lerCommit(path.join(tmp, "nao-existe")) === null, "3c. sem git, não quebra o processo");
  fs.rmSync(tmp, { recursive: true, force: true });

  const SW = fs.readFileSync(path.join(RAIZ, "status-whatsapp.js"), "utf8");
  ok(/codigo: COMMIT_CARREGADO/.test(SW), "3d. o bot grava a versão dele junto com o estado do WhatsApp");
  ok(/versaoBot: whatsapp\.codigo/.test(SW), "3e. e o resumo devolve");
  ok(/versaoPainel: VersaoDoCodigo\.COMMIT_CARREGADO/.test(PAINEL), "3f. o painel manda a dele");
  ok(/if \(vp && vb && vp !== vb\) \{\s*texto\.textContent \+= ` · ATENÇÃO/.test(TELA) && /Desligue e ligue a Carla/.test(TELA), "3g. versões diferentes viram aviso com o que fazer");
}

console.log(`confirmacao-velha: ${passou} passaram, ${erros.length} falharam`);
if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
