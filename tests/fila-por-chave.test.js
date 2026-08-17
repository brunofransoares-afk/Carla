/*
 * Garante que duas mensagens do mesmo telefone nunca alterem a sessão ao mesmo tempo,
 * sem transformar o bot inteiro numa fila única para famílias diferentes.
 *
 * Roda com: node tests/fila-por-chave.test.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { criarFilaPorChave } = require("../fila-por-chave.js");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function espera(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

(async () => {
  const fila = criarFilaPorChave();
  const eventos = [];

  let liberarPrimeira;
  const primeira = fila.enfileirar("+551", async () => {
    eventos.push("primeira-inicio");
    await new Promise((resolve) => { liberarPrimeira = resolve; });
    eventos.push("primeira-fim");
    return "primeira-ok";
  });
  const segunda = fila.enfileirar("+551", async () => {
    eventos.push("segunda-inicio");
    await espera(1);
    eventos.push("segunda-fim");
    return "segunda-ok";
  });

  await espera(5);
  ok(eventos.join(",") === "primeira-inicio", "a segunda tarefa do mesmo telefone espera");
  liberarPrimeira();
  const resultados = await Promise.all([primeira, segunda]);
  ok(eventos.join(",") === "primeira-inicio,primeira-fim,segunda-inicio,segunda-fim",
    "tarefas do mesmo telefone terminam na ordem");
  ok(resultados.join(",") === "primeira-ok,segunda-ok", "cada chamada recebe seu resultado");

  const paralelos = [];
  let liberarA;
  const a = fila.enfileirar("+552", async () => {
    paralelos.push("a-inicio");
    await new Promise((resolve) => { liberarA = resolve; });
    paralelos.push("a-fim");
  });
  const b = fila.enfileirar("+553", async () => {
    paralelos.push("b-inicio");
    paralelos.push("b-fim");
  });
  await espera(5);
  ok(paralelos.includes("a-inicio") && paralelos.includes("b-fim"),
    "telefones diferentes continuam em paralelo");
  liberarA();
  await Promise.all([a, b]);

  let liberarEncerramento;
  fila.enfileirar("+555", () => new Promise((resolve) => { liberarEncerramento = resolve; }));
  let filaEsvaziou = false;
  const esperaFila = fila.aguardarVazio().then(() => { filaEsvaziou = true; });
  await espera(5);
  ok(!filaEsvaziou, "aguardarVazio espera uma conversa que já está em processamento");
  liberarEncerramento();
  await esperaFila;
  ok(filaEsvaziou, "aguardarVazio libera depois que o processamento termina");

  const depoisDaFalha = [];
  await fila.enfileirar("+554", async () => { throw new Error("falha esperada"); }).catch(() => {});
  await fila.enfileirar("+554", async () => { depoisDaFalha.push("rodou"); });
  ok(depoisDaFalha.length === 1, "uma falha não bloqueia mensagens seguintes");

  await espera(0);
  ok(fila.quantidadeDeChaves() === 0, "a fila limpa chaves que já terminaram");

  const servidor = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const usos = servidor.match(/filaMensagens\.enfileirar\(telefone/g) || [];
  ok(usos.length >= 4, "o servidor usa a fila no debounce, reenvio, áudio e encerramento");
  ok(/await filaMensagens\.aguardarVazio\(\);/.test(servidor),
    "o encerramento espera conversas que já estavam sendo processadas");

  console.log(`\nfila-por-chave: ${passou} passaram, ${falhou} falharam`);
  if (falhou) {
    erros.forEach((e) => console.log("  FALHOU: " + e));
    process.exit(1);
  }
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
