/*
 * Bateria: o painel entra pela sessão do SPI, sem segredo compartilhado.
 *
 * O dono pediu o login automático e, sobre o passo de gravar o mesmo segredo no Supabase e no
 * .env da VPS: "nao entendi oq eu tenho q fazer... faz vc". Nenhum dos dois lugares é
 * alcançável daqui, e o repositório é público, então o segredo não pode vir por ele.
 *
 * Este caminho troca o segredo pelo próprio Supabase: o painel pergunta a ele de quem é o
 * token da sessão, e confere o e-mail numa lista. O que esta bateria guarda é, quase todo,
 * RECUSA, porque é aqui que um assinante qualquer do SPI tentaria entrar no painel do Dr.
 * Bruno com uma sessão perfeitamente válida.
 *
 * Roda com:  node tests/sso-supabase.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const S = require("../sso-supabase.js");

let passou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const BASE = { url: "https://projeto.supabase.co", chavePublica: "sb_publishable_x", emailsPermitidos: ["dono@x.com"] };
// Um Supabase de mentira: devolve o usuário do token, ou 401.
const supabase = (usuarios) => async (url, opcoes) => {
  supabase.ultimo = { url, opcoes };
  const token = String((opcoes.headers.Authorization || "")).replace("Bearer ", "");
  if (!usuarios[token]) return { ok: false, status: 401, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => usuarios[token] };
};
const verificar = (token, extra = {}) => S.verificarSessaoSupabase(token, { ...BASE, buscar: supabase({ "tok.dono": { email: "Dono@X.com" }, "tok.outro": { email: "outro@x.com" }, "tok.semEmail": {} }), ...extra });

async function main() {
  // ------------------------------------------------- 1. o dono entra
  {
    const r = await verificar("tok.dono");
    ok(r.ok, "1. a sessão do dono entra");
    eq(r.email, "dono@x.com", "1b. com o e-mail normalizado");
    eq(supabase.ultimo.url, "https://projeto.supabase.co/auth/v1/user", "1c. perguntando ao próprio Supabase");
    eq(supabase.ultimo.opcoes.headers.apikey, "sb_publishable_x", "1d. com a chave pública do projeto");
  }

  // ------------------------------------------------- 2. a recusa que importa
  {
    const r = await verificar("tok.outro");
    ok(!r.ok, "2. sessão VÁLIDA de outro assinante do SPI não entra: é o caso que esta lista existe pra barrar");
    ok(/fora da lista/.test(r.motivo || ""), "2b. e o log diz por quê");
    const semLista = await verificar("tok.dono", { emailsPermitidos: [] });
    ok(!semLista.ok && /nenhum e-mail autorizado/.test(semLista.motivo),
      "2c. sem lista, ninguém entra: lista vazia não pode virar 'qualquer um'");
    const semEmail = await verificar("tok.semEmail");
    ok(!semEmail.ok && /sem e-mail/.test(semEmail.motivo), "2d. sessão sem e-mail não entra");
    // O Supabase disse não, mesmo que o corpo traga um e-mail da lista: vale o status.
    const negado = await S.verificarSessaoSupabase("tok.dono", { ...BASE, buscar: async () => ({ ok: false, status: 401, json: async () => ({ email: "dono@x.com" }) }) });
    ok(!negado.ok && /401/.test(negado.motivo), "2f. 401 do Supabase é recusa, seja qual for o corpo");
    ok(!(await verificar("tok.falso")).ok, "2e. token que o Supabase não reconhece não entra");
  }

  // ------------------------------------------------- 3. entrada torta
  {
    ok(!(await verificar("")).ok, "3. sem token");
    ok(!(await verificar("a".repeat(S.LIMITE_TOKEN + 1))).ok, "3b. token gigante");
    let perguntou = 0;
    const torto = await S.verificarSessaoSupabase("tok.dono\nHost: x", { ...BASE, buscar: async () => { perguntou++; return { ok: true, json: async () => ({ email: "dono@x.com" }) }; } });
    ok(!torto.ok && perguntou === 0, "3c. token com caractere fora do formato nem chega a ir pro Supabase");
    ok(!(await verificar("tok.dono", { url: "" })).ok, "3d. projeto não configurado");
    const caido = await S.verificarSessaoSupabase("tok.dono", { ...BASE, buscar: async () => { throw new Error("sem rede"); } });
    ok(!caido.ok && /inalcançável/.test(caido.motivo), "3e. Supabase fora do ar vira recusa, não exceção");
    const ilegivel = await S.verificarSessaoSupabase("tok.dono", { ...BASE, buscar: async () => ({ ok: true, json: async () => { throw new Error("x"); } }) });
    ok(!ilegivel.ok, "3f. resposta ilegível também");
  }

  // ------------------------------------------------- 4. a lista de e-mails
  {
    eq(S.listaDeEmails("a@x.com, B@Y.com ,").join("|"), "a@x.com|b@y.com", "4. vírgulas, espaços e maiúsculas");
    eq(S.listaDeEmails("sem-arroba").length, 0, "4b. o que não é e-mail não entra na lista");
  }

  // ------------------------------------------------- 5. a página e o servidor
  {
    const pagina = S.paginaDeEntrada();
    ok(/location\.hash/.test(pagina), "5. a página lê o token do FRAGMENTO, que não vai pro servidor nem pros logs");
    ok(/history\.replaceState\(null, "", location\.pathname\)/.test(pagina),
      "5b. e tira o token da barra de endereço na hora, antes de qualquer outra coisa");
    ok(/fetch\("\/sso\/spi", \{\s*method: "POST"/.test(pagina), "5c. o token vai no corpo de um POST, nunca em query string");
    ok(!/<script src=/.test(pagina) && !/https?:\/\//.test(pagina), "5d. a página não carrega nada de fora");

    const PAINEL = fs.readFileSync(path.join(__dirname, "..", "painel-server.js"), "utf8");
    const rota = PAINEL.slice(PAINEL.indexOf('caminhoPedido === "/sso/spi"'), PAINEL.indexOf('if (caminhoPedido === "/sso" && req.method === "GET") {\n    if (!SSO_SEGREDO)'));
    ok(rota.length > 0, "6. a rota existe");
    ok(/limiteLogin\.verificar\(cliente\);\s*if \(!limite\.permitido\) \{\s*res\.writeHead\(429/.test(rota), "6b. com o mesmo limitador do login por senha");
    const posConfere = rota.indexOf("SsoSupabase.verificarSessaoSupabase(");
    const posAbre = rota.indexOf("sessoes.abrir()");
    ok(posConfere > 0 && posAbre > posConfere, "6c. a sessão só abre DEPOIS de o Supabase confirmar");
    ok(/Sso\.caminhoInternoSeguro\(corpo && corpo\.dest\)/.test(rota),
      "6d. e o destino passa pela mesma trava do ticket: nunca redireciona pra fora do painel");
    ok(/res\.end\(JSON\.stringify\(\{ ok: false \}\)\);/.test(rota) && /console\.warn\(`\[SSO SPI\] Recusado/.test(rota),
      "6e. a recusa não diz o motivo pra quem tenta; o log diz");
    ok(/emailsPermitidos: SsoSupabase\.listaDeEmails\(process\.env\.CARLA_SSO_EMAILS \|\| "brunofransoares@gmail\.com"\)/.test(PAINEL),
      "6f. só o dono, por padrão, sem precisar configurar nada");

    // A página fica ANTES da checagem de senha: ela é justamente o caminho de quem ainda não
    // tem sessão. E depois da fonte, que é a outra coisa que precisa vir antes.
    const posPagina = PAINEL.indexOf("SsoSupabase.paginaDeEntrada()");
    const posSenha = PAINEL.indexOf("enviarPaginaLogin(res, {", PAINEL.indexOf('caminhoPedido.startsWith("/webhook/")'));
    ok(posPagina > 0 && (posSenha < 0 || posPagina < posSenha), "6g. a página de entrada não exige senha");
  }

  console.log(`sso-supabase: ${passou} passaram, ${erros.length} falharam`);
  if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
