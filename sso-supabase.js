"use strict";

/*
 * LOGIN DO PAINEL PELA SESSÃO DO SPI, SEM SEGREDO COMPARTILHADO (2026-10-01).
 *
 * O dono: "quero que o painel da carla entre de forma automaatica pelo celular e pelo PC
 * quando eu estiver logado no SPI, nao exigindo senha do painel". E depois, sobre o passo de
 * pôr o mesmo segredo no Supabase e no .env do painel: "nao entendi oq eu tenho q fazer...
 * faz vc".
 *
 * O caminho antigo (sso-do-spi.js) continua existindo e funcionando, mas dependia de um
 * segredo gravado à mão em dois lugares, e nenhum dos dois é alcançável daqui: o .env do
 * painel mora na VPS, e o repositório é público, então o segredo não pode vir por ele.
 *
 * ESTE CAMINHO NÃO PRECISA DE SEGREDO NENHUM. O SPI já prova quem o médico é: ele está logado
 * no Supabase, e o Supabase assina o token dessa sessão. O painel pega esse token, pergunta ao
 * próprio Supabase de quem ele é (GET /auth/v1/user), e confere o e-mail numa lista curta.
 * Quem garante a identidade é o Supabase; o painel só decide quem pode entrar. A URL e a
 * chave pública do projeto não são segredo (estão no js/config.js do SPI, público).
 *
 * A LISTA DE E-MAILS É A TRAVA QUE IMPORTA. Todo assinante do SPI tem sessão válida no mesmo
 * Supabase, e este painel tem conversa e dado de paciente do consultório do Dr. Bruno. Sessão
 * válida não basta: tem que ser ELE. Sem lista, nenhum e-mail entra.
 *
 * O token chega pelo FRAGMENTO da URL (#token=...), que o navegador não manda pro servidor
 * nem grava em log de acesso, e só então é postado pra cá pela própria página. Nunca vai em
 * query string.
 */

const LIMITE_TOKEN = 4096;

function listaDeEmails(bruto) {
  const fonte = Array.isArray(bruto) ? bruto : String(bruto || "").split(",");
  return fonte.map((e) => String(e || "").trim().toLowerCase()).filter((e) => /@/.test(e));
}

/*
 * Pergunta ao Supabase de quem é o token. `buscar` é o fetch, injetável pra o teste rodar sem
 * rede. Toda falha vira recusa com motivo, e o motivo vai pro log, nunca pra tela.
 */
async function verificarSessaoSupabase(token, { url, chavePublica, emailsPermitidos, buscar = globalThis.fetch } = {}) {
  const recusar = (motivo) => ({ ok: false, motivo });
  const t = String(token || "").trim();
  if (!t) return recusar("sem token");
  if (t.length > LIMITE_TOKEN) return recusar("token grande demais");
  if (!/^[A-Za-z0-9._-]+$/.test(t)) return recusar("token com caractere inválido");
  const permitidos = listaDeEmails(emailsPermitidos);
  if (!permitidos.length) return recusar("nenhum e-mail autorizado configurado");
  if (!url || !chavePublica) return recusar("projeto do Supabase não configurado");
  if (typeof buscar !== "function") return recusar("sem fetch");

  let resposta;
  try {
    resposta = await buscar(String(url).replace(/\/+$/, "") + "/auth/v1/user", {
      headers: { Authorization: "Bearer " + t, apikey: chavePublica },
    });
  } catch (erro) {
    return recusar("Supabase inalcançável: " + (erro && erro.message));
  }
  if (!resposta || !resposta.ok) return recusar("sessão recusada pelo Supabase (" + (resposta && resposta.status) + ")");
  let usuario;
  try { usuario = await resposta.json(); } catch { return recusar("resposta do Supabase ilegível"); }
  const email = String((usuario && usuario.email) || "").trim().toLowerCase();
  if (!email) return recusar("sessão sem e-mail");
  if (!permitidos.includes(email)) return { ok: false, motivo: "e-mail fora da lista: " + email, email };
  return { ok: true, email };
}

/*
 * A página que recebe o fragmento e posta o token. É mínima de propósito: não carrega nada de
 * fora (o CSP do painel não deixaria), e se o JavaScript falhar o pior caso é cair na tela de
 * senha, que é o que já existia.
 */
function paginaDeEntrada() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entrando no painel</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#071921;color:#fcf4e8;font:16px system-ui,sans-serif}</style>
</head><body><p id="m">Entrando no painel...</p>
<script>
(function () {
  var p = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  var token = p.get("token") || "";
  var dest = p.get("dest") || "/";
  // Tira o token da barra de endereço na hora: ele não pode ficar no histórico do navegador.
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
  if (!token) { location.replace("/"); return; }
  fetch("/sso/spi", {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: token, dest: dest })
  }).then(function (r) { return r.json().catch(function () { return {}; }); })
    .then(function (d) { location.replace(d && d.ok && d.destino ? d.destino : "/"); })
    .catch(function () { location.replace("/"); });
})();
</script></body></html>`;
}

module.exports = { verificarSessaoSupabase, paginaDeEntrada, listaDeEmails, LIMITE_TOKEN };
