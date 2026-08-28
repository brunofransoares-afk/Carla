"use strict";

const fs = require("fs");
const path = require("path");

const painel = fs.readFileSync(path.join(__dirname, "..", "painel-server.js"), "utf8");
const tela = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");

let passou = 0, falhou = 0;
const erros = [];
function ok(condicao, mensagem) {
  if (condicao) passou++;
  else { falhou++; erros.push(mensagem); }
}

const controle = painel.slice(painel.indexOf("async function controlarBot"),
  painel.indexOf("const LIMITE_CORPO"));
ok(/status\.rodando !== deveRodar/.test(controle),
  "1. o servidor não confere o estado real do PM2 depois do comando");
ok(/pm2 save/.test(controle),
  "2. ligar ou desligar pelo painel não persiste o estado para reinício da VPS");
ok(/--update-env/.test(controle),
  "3. ligar a Carla não carrega o ambiente atual do ecosystem");

const rotas = painel.slice(painel.indexOf('req.url === "/api/ligar"'),
  painel.indexOf('req.url === "/api/cancelar"'));
ok(/controlarBot\(true\)/.test(rotas) && /controlarBot\(false\)/.test(rotas),
  "4. as duas rotas não usam o controle verificado");
ok((rotas.match(/resultado\.ok \? 200 : 500/g) || []).length === 2,
  "5. falha do PM2 continua sendo devolvida ao navegador como HTTP 200");

const clique = tela.slice(tela.indexOf('document.getElementById("btn-toggle")'),
  tela.indexOf('document.getElementById("btn-limpar-alertas")'));
ok(/!resp\.ok \|\| !resultado\.ok/.test(clique),
  "6. o botão continua ignorando a falha devolvida pelo servidor");
ok(/alert\(/.test(clique),
  "7. o painel continua escondendo do usuário que não conseguiu ligar a Carla");
ok(/finally[\s\S]*acaoEmAndamento = false;[\s\S]*atualizarStatusBot/.test(clique),
  "8. o botão pode ficar travado sem reler o estado real depois da ação");

console.log(`controle-do-bot: ${passou} passaram, ${falhou} falharam`);
if (falhou) {
  erros.forEach((erro) => console.log("  FALHOU: " + erro));
  process.exit(1);
}
