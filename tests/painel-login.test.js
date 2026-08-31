"use strict";

const fs = require("fs");
const path = require("path");

const fonte = fs.readFileSync(path.join(__dirname, "..", "painel-server.js"), "utf8");
let passou = 0, falhou = 0;
const erros = [];
function ok(condicao, mensagem) {
  if (condicao) passou++;
  else { falhou++; erros.push(mensagem); }
}

const pagina = fonte.slice(fonte.indexOf("function paginaLogin"),
  fonte.indexOf("const html ="));
ok(/<form method="post" action="\/login">/.test(pagina),
  "1. a página própria precisa enviar a senha por POST");
ok(/type="password"/.test(pagina) && /autocomplete="current-password"/.test(pagina),
  "2. o campo precisa ser reconhecido como senha pelo navegador/gerenciador");
ok(/Content-Type": "text\/html; charset=utf-8"/.test(pagina),
  "3. a tela de login precisa ter tipo HTML explícito para não virar arquivo no Safari");

const login = fonte.slice(fonte.indexOf('caminhoPedido === "/login"'),
  fonte.indexOf("if (!autenticacao.ok)"));
ok(/req\.method === "GET"/.test(login) && /req\.method === "POST"/.test(login),
  "4. precisam existir as rotas GET e POST da tela de senha");
ok(/sessoes\.entrar\(parametros\.get\("senha"\), PAINEL_SENHA\)/.test(login),
  "5. o formulário precisa criar sessão usando a senha configurada");
ok(/limiteLogin\.verificar\(cliente\)/.test(login),
  "6. tentativas de senha pelo formulário precisam ter limite");
ok(/Seguranca\.origemPermitida\(req\)/.test(login),
  "7. o formulário precisa recusar envio originado em outro site");
ok(/redirecionar\(res, "\/"\)/.test(login),
  "8. login correto precisa voltar ao painel");

const inicioAutenticacao = fonte.indexOf("const basicSaude");
const comparacaoDaSenha = fonte.indexOf("const autenticacao = sessoes.autenticar", inicioAutenticacao);
const limiteAntesDaSenha = fonte.indexOf("limiteLogin.verificar(cliente)", inicioAutenticacao);
ok(inicioAutenticacao >= 0 && limiteAntesDaSenha > inicioAutenticacao &&
  limiteAntesDaSenha < comparacaoDaSenha && /permitirBasic: basicSaude/.test(fonte),
  "9. Basic Auth precisa ficar só no health check e ser limitado antes de comparar a senha");

const inicioSemSessao = fonte.indexOf("if (!autenticacao.ok)");
const fimSemSessao = fonte.indexOf("limiteLogin.limpar(cliente)", inicioSemSessao);
const semSessao = fonte.slice(inicioSemSessao, fimSemSessao);
ok(/caminhoPedido\.startsWith\("\/api\/"\)/.test(semSessao)
  && /"Content-Type": "application\/json; charset=utf-8"/.test(semSessao),
  "10. API sem sessão precisa responder JSON identificado");
ok(/redirecionar\(res, "\/login"\)/.test(semSessao),
  "11. navegação sem sessão precisa chegar à página própria de senha");
ok(!/WWW-Authenticate/.test(fonte) && !/Senha necessária\./.test(fonte),
  "12. o desafio Basic antigo ainda pode virar download no iPhone");

const dashboard = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");
ok(/resposta\.status === 401[\s\S]*location\.replace\("\/login"\)/.test(dashboard),
  "13. painel já aberto precisa voltar à senha quando a sessão expirar");
ok(/rel="manifest"[^>]*crossorigin="use-credentials"/.test(dashboard),
  "14. manifesto do app precisa enviar o cookie da sessão");

console.log(`painel-login: ${passou} passaram, ${falhou} falharam`);
if (falhou) {
  erros.forEach((erro) => console.log("  FALHOU: " + erro));
  process.exit(1);
}
