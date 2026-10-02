/*
 * Bateria: quando a IA falha, a família não ouve "pode repetir?" em loop.
 *
 * O print (2026-10-02): o Dr. Bruno combinou à mão um encaixe às 19h, retomou o atendimento
 * automático, a mãe respondeu "Posso", "Sim posso", "Instabilidade de quê?", e a Carla
 * respondeu três vezes "Deu uma instabilidade aqui do meu lado, pode repetir sua mensagem?".
 * Essa frase sai quando a chamada à IA dá erro e nenhuma ação foi feita; como o histórico não
 * muda depois da falha, a mensagem seguinte falha do mesmo jeito.
 *
 * Roda com:  node tests/falha-da-ia.test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

let passou = 0;
const erros = [];
function ok(cond, nome) { if (typeof nome !== "string") throw new Error("ok(cond, nome)"); if (cond) passou++; else erros.push(nome); }

const RAIZ = path.join(__dirname, "..");
const { recuperarAposFalha } = require(path.join(RAIZ, "recuperacao-apos-falha.js"));
const C = require(path.join(RAIZ, "cerebro-ia.js"));

// ------------------------------------------------- 1. a falha sem efeito é marcada, com o motivo
{
  const ctxVazio = { acoesRealizadas: [], cancelamentosRealizados: [] };
  const erro = Object.assign(new Error("Limite diário de uso da IA atingido."), { code: "CARLA_LIMITE_IA" });
  const r = recuperarAposFalha({ historico: [], texto: "Posso", ctx: ctxVazio, erro });
  ok(/pode repetir/.test(r.resposta), "1. a primeira resposta continua sendo pedir pra repetir");
  ok(r.falhaDaIA && r.falhaDaIA.codigo === "CARLA_LIMITE_IA" && /Limite diário/.test(r.falhaDaIA.motivo), "1b. e diz o motivo e o código pra quem chama");
  const comEfeito = recuperarAposFalha({ historico: [], texto: "x", ctx: { acoesRealizadas: [], cancelamentosRealizados: [], escalar: "y" }, erro });
  ok(comEfeito.falhaDaIA === null, "1c. falha DEPOIS de uma ação já tem resposta certa e não conta como falha muda");
}

// ------------------------------------------------- 2. o servidor não deixa virar loop
{
  const SERVER = fs.readFileSync(path.join(RAIZ, "server.js"), "utf8");
  const ini = SERVER.indexOf("  if (resultado.falhaDaIA) {");
  const bloco = SERVER.slice(ini, SERVER.indexOf("  sessao.historico = resultado.historico;", ini));
  // Executa o bloco de verdade, com o que ele usa de fora.
  const rodar = (sessao, falhaDaIA) => {
    const resultado = { resposta: "Deu uma instabilidade aqui do meu lado, pode repetir sua mensagem?", falhaDaIA };
    const avisos = [], alertas = [];
    new Function("resultado", "sessao", "now", "Eventos", "Storage", "notificarAtencao", "sock", "telefone", "console", bloco)(
      resultado, sessao, new Date("2026-10-02T16:25:00Z"),
      { registrar() {}, trecho: (t) => t }, { registrarAlertaUrgencia: (a) => alertas.push(a) },
      (_s, a) => avisos.push(a), null, "+5519900000000", { error() {} });
    return { resultado, avisos, alertas };
  };
  const sessao = { falhasSeguidasDaIA: 0 };
  const primeira = rodar(sessao, { motivo: "400 bad request", codigo: null });
  ok(/pode repetir/.test(primeira.resultado.resposta) && !sessao.aguardandoHumano && primeira.avisos.length === 0,
    "2. primeira falha: pede pra repetir (oscilação da API acontece) e não incomoda o Dr. Bruno");
  const segunda = rodar(sessao, { motivo: "400 bad request", codigo: null });
  ok(!/pode repetir/.test(segunda.resultado.resposta) && /verificar com o consultório/.test(segunda.resultado.resposta),
    "2b. segunda seguida: NÃO repete a frase; diz que vai verificar");
  ok(sessao.aguardandoHumano === true && segunda.alertas.length === 1 && segunda.avisos.length === 1, "2c. escala, silencia e avisa ele");
  ok(/400 bad request/.test(segunda.avisos[0].texto), "2d. com o motivo, pra ninguém ficar adivinhando");
  ok(sessao.falhasSeguidasDaIA === 0, "2e. e zera a contagem");

  const s2 = { falhasSeguidasDaIA: 0 };
  const limite = rodar(s2, { motivo: "Limite diário de uso da IA atingido.", codigo: "CARLA_LIMITE_IA" });
  ok(s2.aguardandoHumano === true && /limite diário/i.test(limite.avisos[0].texto), "2f. limite diário: já na primeira, porque não passa sozinho");

  const s3 = { falhasSeguidasDaIA: 1 };
  rodar(s3, null);
  ok(s3.falhasSeguidasDaIA === 0, "2g. uma resposta boa zera a contagem: falhas espaçadas não escalam");
}

// ------------------------------------------------- 3. falas seguidas do mesmo lado viram uma
{
  const j = C._testes.juntarFalasSeguidas([
    { role: "user", content: "Giovana, Lis Soares" },
    { role: "assistant", content: "Vou confirmar com o Dr. Bruno" },
    { role: "assistant", content: "Consegui encaixe pra hoje 19h. Poderia vir?" },
  ]);
  ok(j.length === 2 && j[1].role === "assistant" && /Vou confirmar[\s\S]*19h/.test(j[1].content),
    "3. a fala da Carla e a do Dr. Bruno, uma atrás da outra, vão como uma só, na ordem");
  const original = [{ role: "user", content: "a" }, { role: "user", content: "b" }];
  C._testes.juntarFalasSeguidas(original);
  ok(original[0].content === "a", "3b. sem mexer na lista de quem chamou");
}

// ------------------------------------------------- 4. o limite conta o cache pelo custo real
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "limite-"));
  process.env.CARLA_ARQUIVO_USO_IA = path.join(dir, "uso.json");
  delete require.cache[require.resolve(path.join(RAIZ, "limite-ia.js"))];
  const L = require(path.join(RAIZ, "limite-ia.js"));
  L.registrarTokens({ input_tokens: 1000, cache_read_input_tokens: 20000, cache_creation_input_tokens: 0, output_tokens: 300 });
  const uso = JSON.parse(fs.readFileSync(process.env.CARLA_ARQUIVO_USO_IA, "utf8"));
  ok(uso.tokensEntrada === 3000, "4. 20 mil lidos do cache contam 2 mil (custam um décimo), não 20 mil");
  const fonte = fs.readFileSync(path.join(RAIZ, "limite-ia.js"), "utf8");
  ok(/CARLA_MAX_CHAMADAS_IA_DIA, 1000\)/.test(fonte), "4b. o teto de chamadas cabe num dia cheio de consultório");
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`falha-da-ia: ${passou} passaram, ${erros.length} falharam`);
if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
