"use strict";

const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const S = require(path.join(__dirname, "..", "painel-seguranca.js"));

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) passou++; else { falhou++; erros.push(msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)})`); }

function pedido({ senha, cookie, ip = "203.0.113.4" } = {}) {
  const headers = { "x-forwarded-for": ip };
  if (senha != null) headers.authorization = "Basic " + Buffer.from("medico:" + senha).toString("base64");
  if (cookie) headers.cookie = cookie;
  return { headers, socket: { remoteAddress: "127.0.0.1" } };
}

// A senha nunca é comparada com === e entradas de tamanhos diferentes não fazem a função lançar.
eq(S.compararSegredo("correta", "correta"), true, "1. aceita segredo igual");
eq(S.compararSegredo("errada", "correta"), false, "1b. recusa segredo diferente");
eq(S.compararSegredo("x", "uma-senha-muito-maior"), false, "1c. tamanhos diferentes são seguros");

// A sessão é aleatória, reaproveitada pelo cookie e deixa de valer ao expirar.
{
  let agora = 1000;
  const sessoes = S.criarSessoes({ nomeCookie: "sessao", ttlMs: 5000, agora: () => agora });
  const login = sessoes.autenticar(pedido({ senha: "correta" }), "correta");
  ok(login.ok && login.nova, "2. login correto cria sessão");
  ok(login.token && !login.token.includes("correta"), "2b. token não contém a senha");
  const repetido = sessoes.autenticar(pedido({ cookie: `sessao=${login.token}` }), "correta");
  eq(repetido.token, login.token, "2c. cookie válido reaproveita sessão");
  agora += 6000;
  eq(sessoes.autenticar(pedido({ cookie: `sessao=${login.token}` }), "correta").ok, false,
    "2d. sessão expira");
  eq(sessoes.autenticar(pedido({ senha: "errada" }), "correta").ok, false,
    "2e. senha errada não cria sessão");
  eq(sessoes.autenticar(pedido({ senha: "correta" }), "correta", { permitirBasic: false }).ok,
    false, "2f. Basic Auth pode ser desligado nas rotas humanas");

  const formulario = sessoes.entrar("correta", "correta");
  ok(formulario.ok && formulario.nova,
    "2g. formulário de senha cria a mesma sessão segura sem depender de Basic Auth");
  eq(sessoes.entrar("errada", "correta").ok, false,
    "2h. formulário recusa senha errada");
}

{
  const cookie = S.cookieSeguro("sessao", "aleatorio", 60);
  for (const atributo of ["HttpOnly", "Secure", "SameSite=Strict", "Max-Age=60"]) {
    ok(cookie.includes(atributo), "3. cookie contém " + atributo);
  }
}

// O limitador bloqueia depois do teto e reabre apenas quando a janela termina.
{
  let agora = 0;
  const limite = S.criarLimitador({ maximo: 2, janelaMs: 1000, agora: () => agora });
  ok(limite.verificar("ip").permitido, "4. primeira tentativa entra");
  ok(limite.verificar("ip").permitido, "4b. segunda tentativa entra");
  eq(limite.verificar("ip").permitido, false, "4c. excesso é bloqueado");
  agora = 1001;
  ok(limite.verificar("ip").permitido, "4d. janela nova libera novamente");
}

eq(S.identificarCliente(pedido({ ip: "ip-inventado, 198.51.100.7" })), "198.51.100.7",
  "5. usa o último IP acrescentado pelo nginx, não o primeiro inventado pelo cliente");
{
  const req = pedido({ ip: "ip-inventado, 198.51.100.7" });
  req.headers["x-real-ip"] = "203.0.113.9";
  eq(S.identificarCliente(req), "203.0.113.9", "5b. prefere X-Real-IP do nginx");
}

{
  const mesma = pedido();
  mesma.headers.host = "painel.exemplo.com";
  mesma.headers.origin = "https://painel.exemplo.com";
  eq(S.origemPermitida(mesma), true, "5c. aceita operação da própria origem");
  mesma.headers.origin = "https://site-malicioso.example";
  eq(S.origemPermitida(mesma), false, "5d. recusa Origin de outro site");
  delete mesma.headers.origin;
  mesma.headers["sec-fetch-site"] = "cross-site";
  eq(S.origemPermitida(mesma), false, "5e. recusa pedido cross-site mesmo sem Origin");
  delete mesma.headers["sec-fetch-site"];
  eq(S.origemPermitida(mesma), true, "5f. permite cliente autenticado sem cabeçalho de navegador");

  mesma.headers.origin = "null";
  eq(S.origemPermitida(mesma), false,
    "5g. APIs autenticadas continuam recusando Origin null");
  eq(S.origemLoginPermitida(mesma), true,
    "5h. login aceita Origin null enviado pelo Safari em navegação direta");
  mesma.headers["sec-fetch-site"] = "cross-site";
  eq(S.origemLoginPermitida(mesma), false,
    "5i. login continua recusando Origin null quando a página veio de outro site");
}

// O DDI explícito nunca pode ser trocado por +55. Esse era o motivo de um contato dos EUA
// aparecer normalmente no painel, mas o clique em "Silenciar" gravar outro número.
eq(S.normalizarTelefoneManual("+1 (619) 757-3958"), "+16197573958",
  "6. preserva telefone internacional que já vem com +1");
eq(S.normalizarTelefoneManual("+55 (19) 99999-0000"), "+5519999990000",
  "6b. preserva também DDI brasileiro explícito");
eq(S.normalizarTelefoneManual("19 99999-0000"), "+5519999990000",
  "6c. digitação nacional sem DDI continua assumindo Brasil");
eq(S.normalizarTelefoneManual("001 619 757 3958"), "+16197573958",
  "6d. aceita prefixo internacional 00");
eq(S.normalizarTelefoneManual(""), null, "6e. recusa telefone vazio");
eq(S.normalizarTelefoneManual("+1234567890123456"), null, "6f. recusa número acima do limite E.164");
{
  const fonte = fs.readFileSync(path.join(__dirname, "..", "painel-server.js"), "utf8");
  const rota = fonte.slice(fonte.indexOf('req.url === "/api/silenciar"'),
    fonte.indexOf('req.url === "/api/dessilenciar"'));
  ok(/Seguranca\.normalizarTelefoneManual\(corpo\.telefone\)/.test(rota),
    "6g. a rota de silenciar usa a normalização que preserva o DDI");
}

function corpo(partes, headers = {}) {
  const req = new EventEmitter();
  req.headers = headers;
  process.nextTick(() => { for (const p of partes) req.emit("data", Buffer.from(p)); req.emit("end"); });
  return req;
}

(async () => {
  const json = await S.lerCorpo(corpo(['{"ok":', "true}"]), { limite: 64, json: true });
  eq(json.ok, true, "7. lê JSON válido em mais de um bloco");
  try { await S.lerCorpo(corpo(["xxxxxxxxx"]), { limite: 4, json: false });
    ok(false, "7b. aceitou corpo grande");
  } catch (e) { eq(e.statusCode, 413, "7b. corpo grande devolve 413"); }
  try { await S.lerCorpo(corpo(["{"]), { limite: 64, json: true });
    ok(false, "7c. aceitou JSON inválido");
  } catch (e) { eq(e.statusCode, 400, "7c. JSON inválido devolve 400"); }

  console.log(`\npainel-seguranca: ${passou} passaram, ${falhou} falharam`);
  if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
})().catch((erro) => { console.error(erro); process.exit(1); });
