/**
 * LOGIN ÚNICO SPI -> painel da Carla, a metade de cá.
 *
 * O SPI já tinha escrito a metade dele (Edge Function "carla-sso") e deixado o contrato
 * documentado esperando o painel. Esta bateria é esse contrato, verificado: um ticket
 * assinado entra; qualquer variação dele não entra, e cada recusa é testada uma a uma,
 * porque a soma delas é o que impede o SSO de virar uma porta aberta.
 *
 * Roda com:  node tests/sso-do-spi.test.js
 */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
let passou = 0, falhou = 0; const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const Sso = require(path.join(__dirname, "..", "sso-do-spi.js"));
const Seguranca = require(path.join(__dirname, "..", "painel-seguranca.js"));
const PAINEL = fs.readFileSync(path.join(__dirname, "..", "painel-server.js"), "utf8");

const SEGREDO = "um-segredo-bem-longo-de-teste-0123456789";
const AGORA = new Date("2026-09-24T12:00:00.000Z");
const epoch = (d) => Math.floor(d.getTime() / 1000);

// Monta um ticket igual ao que a Edge Function do SPI monta.
function ticketDe(payload, { segredo = SEGREDO } = {}) {
  const corpo = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const assinatura = crypto.createHmac("sha256", segredo).update(corpo).digest("base64url");
  return `${corpo}.${assinatura}`;
}
let contador = 0;
const payloadBom = (extra = {}) => ({
  sub: "uuid-do-medico", email: "bruno@exemplo.com",
  iat: epoch(AGORA), exp: epoch(AGORA) + 60,
  nonce: `n${++contador}`, dest: "/", ...extra,
});
const conferir = (t, opcoes = {}) => Sso.verificarTicket(t, SEGREDO, { agora: AGORA, ...opcoes });

// ------------------------------------------------- 1. o ticket bom entra
{
  const r = conferir(ticketDe(payloadBom()));
  ok(r.ok, "1. ticket assinado, no prazo e com nonce: entra");
  eq(r.email, "bruno@exemplo.com", "1b. e o painel fica sabendo quem entrou, pro log");
  eq(r.destino, "/", "1c. com o destino pedido");
  const comDest = conferir(ticketDe(payloadBom({ dest: "/?aba=agenda" })));
  eq(comDest.destino, "/?aba=agenda", "1d. o SPI pode mandar abrir numa aba específica");
}

// ------------------------------------------------- 2. assinatura: a primeira porta
{
  ok(!conferir(ticketDe(payloadBom(), { segredo: "outro-segredo" })).ok, "2. assinado com outro segredo: recusa");
  const t = ticketDe(payloadBom());
  const [corpo] = t.split(".");
  ok(!conferir(`${corpo}.assinaturaInventada`).ok, "2b. assinatura inventada: recusa");
  ok(!conferir(corpo).ok, "2c. sem assinatura nenhuma: recusa");
  ok(!conferir(`${corpo}.`).ok, "2d. assinatura vazia: recusa");
  ok(!conferir(`${corpo}.a.b`).ok, "2e. mais de duas partes: recusa");
  // O ataque que a ordem das checagens impede: payload alterado mantendo o resto.
  const adulterado = Buffer.from(JSON.stringify(payloadBom({ exp: epoch(AGORA) + 999999 })), "utf8").toString("base64url");
  ok(!conferir(`${adulterado}.${t.split(".")[1]}`).ok, "2f. payload trocado com a assinatura antiga: recusa");
  eq(conferir(`${adulterado}.${t.split(".")[1]}`).motivo, "Assinatura inválida.", "2g. e cai na assinatura, ANTES de acreditar em qualquer campo do payload");
}

// ------------------------------------------------- 3. prazo
{
  ok(!conferir(ticketDe(payloadBom({ exp: epoch(AGORA) - 1 }))).ok, "3. vencido há 1 segundo: recusa");
  ok(!conferir(ticketDe(payloadBom({ exp: epoch(AGORA) }))).ok, "3b. vencendo exatamente agora: recusa (a borda é fechada)");
  ok(conferir(ticketDe(payloadBom({ exp: epoch(AGORA) + 1 }))).ok, "3c. um segundo de validade: entra");
  ok(!conferir(ticketDe(payloadBom({ exp: undefined }))).ok, "3d. sem exp: recusa, em vez de valer pra sempre");
  ok(!conferir(ticketDe(payloadBom({ exp: "amanhã" }))).ok, "3e. exp que não é número: recusa");
  // Teto próprio: o painel não aceita validade longa nem se o SPI assinar.
  ok(!conferir(ticketDe(payloadBom({ exp: epoch(AGORA) + Sso.MAX_VALIDADE_SEGUNDOS + 1 }))).ok, "3f. validade acima do teto: recusa, senão o ticket vira senha permanente na barra de endereço");
  ok(conferir(ticketDe(payloadBom({ exp: epoch(AGORA) + Sso.MAX_VALIDADE_SEGUNDOS }))).ok, "3g. exatamente no teto ainda entra");
  eq(Sso.MAX_VALIDADE_SEGUNDOS, 300, "3h. o teto é de cinco minutos: folga pra relógio fora de hora, sem virar credencial durável");
}

// ------------------------------------------------- 4. nonce: o mesmo ticket não entra duas vezes
{
  const nonces = Sso.criarNonces({ agora: () => AGORA.getTime() });
  const t = ticketDe(payloadBom({ nonce: "repetido" }));
  ok(conferir(t, { nonces }).ok, "4. primeira vez entra");
  ok(!conferir(t, { nonces }).ok, "4b. segunda vez NÃO entra: um link copiado do histórico não vira acesso repetível");
  eq(conferir(t, { nonces }).motivo, "Ticket já usado.", "4c. dizendo exatamente isso no log");
  ok(!conferir(ticketDe(payloadBom({ nonce: "" })), { nonces }).ok, "4d. ticket sem nonce: recusa");
  // Sem a lista, o módulo não inventa memória: quem chama é que decide guardar.
  ok(conferir(t).ok && conferir(t).ok, "4e. sem lista de nonces passada, não há repetição a detectar (é o chamador que liga isso)");
}

// ------------------------------------------------- 5. a lista de nonces, sozinha
{
  const relogio = { valor: Date.parse("2026-09-24T12:00:00.000Z") };
  const nonces = Sso.criarNonces({ agora: () => relogio.valor, maximo: 3 });
  nonces.guardar("a", epoch(AGORA) + 60);
  ok(nonces.jaUsado("a"), "5. guardado, fica marcado");
  ok(!nonces.jaUsado("b"), "5b. o que não foi guardado, não");
  relogio.valor += 61 * 1000;
  ok(!nonces.jaUsado("a"), "5c. passado o vencimento, some sozinho: a lista não cresce pra sempre");
  relogio.valor = Date.parse("2026-09-24T12:00:00.000Z");
  for (const n of ["1", "2", "3", "4", "5"]) nonces.guardar(n, epoch(AGORA) + 60);
  ok(nonces.tamanho() <= 3, "5d. e tem teto: nonce não vira vazamento de memória");
  ok(nonces.jaUsado("5"), "5e. com os mais novos preservados");
}

// ------------------------------------------------- 6. destino: nunca redirecionador aberto
{
  const d = Sso.caminhoInternoSeguro;
  eq(d("/"), "/", "6. a raiz passa");
  eq(d("/?aba=funil"), "/?aba=funil", "6b. caminho com query passa");
  eq(d("https://site-de-golpe.com"), "/", "6c. endereço completo NÃO passa: viraria redirecionador aberto saindo do domínio do consultório");
  eq(d("//site-de-golpe.com"), "/", "6d. e a forma com duas barras também não, que o navegador segue igual");
  eq(d("/\\site-de-golpe.com"), "/", "6e. nem a variação com barra invertida");
  eq(d("javascript:alert(1)"), "/", "6f. nem javascript:");
  eq(d("/api/status\nX-Coisa: 1"), "/", "6g. e caractere de controle cai, que é o que permitiria forjar cabeçalho na resposta");
  eq(d(null) + d(undefined) + d(42), "///", "6h. lixo vira a raiz, nunca erro");
  eq(d("/" + "a".repeat(999)).length, 300, "6i. com teto de tamanho");
}

// ------------------------------------------------- 7. o segredo e o ticket cru
{
  ok(!Sso.verificarTicket(ticketDe(payloadBom()), "", { agora: AGORA }).ok, "7. sem segredo configurado, nada entra");
  ok(!Sso.verificarTicket(ticketDe(payloadBom()), null, { agora: AGORA }).ok, "7b. nem com segredo nulo");
  ok(!conferir("").ok && !conferir(null).ok, "7c. ticket vazio recusa");
  ok(!conferir("a".repeat(5000)).ok, "7d. ticket gigante recusa antes de tentar decodificar");
  const corpoRuim = Buffer.from("nao sou json", "utf8").toString("base64url");
  const assRuim = crypto.createHmac("sha256", SEGREDO).update(corpoRuim).digest("base64url");
  eq(conferir(`${corpoRuim}.${assRuim}`).motivo, "Payload ilegível.", "7e. payload assinado mas ilegível: recusa sem quebrar");
  const corpoLista = Buffer.from("[1,2,3]", "utf8").toString("base64url");
  const assLista = crypto.createHmac("sha256", SEGREDO).update(corpoLista).digest("base64url");
  ok(!conferir(`${corpoLista}.${assLista}`).ok, "7f. payload que é lista, não objeto: recusa");
}

// ------------------------------------------------- 8. a sessão do painel abre sem senha, e só aqui
{
  const sessoes = Seguranca.criarSessoes({ nomeCookie: "x", ttlMs: 60000 });
  const s = sessoes.abrir();
  ok(s.ok && typeof s.token === "string" && s.token.length >= 32, "8. abrir() cria sessão de verdade, com token aleatório");
  ok(sessoes.abrir().token !== s.token, "8b. e um token diferente a cada vez");
  ok(!sessoes.entrar("errada", "certa").ok, "8c. entrar() continua exigindo a senha certa");
  ok(sessoes.entrar("certa", "certa").ok, "8d. e aceitando a certa");
  const fonte = fs.readFileSync(path.join(__dirname, "..", "painel-seguranca.js"), "utf8");
  ok(/function entrar\(recebida, senha\) \{\s*\n\s*if \(!compararSegredo\(recebida, senha\)\) return \{ ok: false \};\s*\n\s*return abrir\(\);/.test(fonte), "8e. entrar() é abrir() com a senha conferida antes: um caminho só pra criar sessão");
}

// ------------------------------------------------- 9. a rota do painel
{
  const rota = PAINEL.slice(PAINEL.indexOf('caminhoPedido === "/sso"'), PAINEL.indexOf('caminhoPedido.startsWith("/webhook/")'));
  ok(rota.length > 200, "9. a rota /sso existe");
  ok(PAINEL.indexOf('caminhoPedido === "/sso"') < PAINEL.indexOf("if (!autenticacao.ok)"), "9b. e fica ANTES da checagem de senha: a prova vem no ticket");
  ok(/if \(!SSO_SEGREDO\) \{[\s\S]{0,200}res\.writeHead\(503/.test(rota), "9c. sem o segredo, responde 503 dizendo qual variável falta, não 401");
  ok(/falta CARLA_SSO_SECRET no \.env do painel/.test(rota), "9d. nomeando a variável");
  ok(/const limite = limiteLogin\.verificar\(cliente\);/.test(rota), "9e. limitado pelo MESMO limitador do login por senha: adivinhar assinatura custa o mesmo que adivinhar senha");
  ok(/const conferido = Sso\.verificarTicket\(ticket, SSO_SEGREDO, \{ nonces \}\);/.test(rota), "9f. confere o ticket com a lista de nonces do processo");
  ok(/console\.warn\(`\[SSO\] Ticket recusado \(\$\{conferido\.motivo\}\)/.test(rota), "9g. o motivo da recusa vai pro log");
  ok(/Este link de entrada não vale mais/.test(rota) && !/\$\{conferido\.motivo\}[^`]*<\/p>/.test(rota), "9h. e não pra tela: pra quem tenta adivinhar, toda recusa é igual");
  const posConfere = rota.indexOf("Sso.verificarTicket(");
  const posAbre = rota.indexOf("sessoes.abrir()");
  ok(posConfere > 0 && posAbre > posConfere, "9i. a sessão só abre DEPOIS de o ticket passar");
  ok(/redirecionar\(res, conferido\.destino\);/.test(rota), "9j. e manda pro destino já peneirado, nunca pro que veio cru");
  ok(/limiteLogin\.limpar\(cliente\);/.test(rota), "9k. entrada boa zera o limitador, como no login por senha");
  ok(/const SSO_SEGREDO = String\(process\.env\.CARLA_SSO_SECRET \|\| ""\)\.trim\(\) \|\| null;/.test(PAINEL), "9l. o segredo vem do .env e some se vier vazio");
  ok(!/CARLA_SSO_SECRET\s*=\s*"[^"]+"/.test(PAINEL), "9m. e nenhum valor de segredo fica escrito no repositório");
}

console.log(`\nsso-do-spi: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
