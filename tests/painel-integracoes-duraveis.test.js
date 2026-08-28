/*
 * O painel não pode voltar a fazer Google/SPI como chamada única dentro do clique.
 * Esta bateria trava o encanamento: persistência local, caixa durável compartilhada e
 * recuperação da pequena janela entre as duas gravações.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const fonte = fs.readFileSync(path.join(__dirname, "..", "painel-server.js"), "utf8");
const storage = fs.readFileSync(path.join(__dirname, "..", "storage-node.js"), "utf8");

let passou = 0;
const falhas = [];
function ok(condicao, mensagem) {
  if (condicao) passou++;
  else falhas.push(mensagem);
}

const inicio = fonte.indexOf('if (req.url === "/api/cancelar"');
const fim = fonte.indexOf('if (req.url === "/api/limpar-alertas"', inicio);
const rotaCancelar = fonte.slice(inicio, fim);

ok(/criarIntegracoesDuraveis/.test(fonte), "painel instancia a integração durável");
ok(/aoVincularAppAgendamento:[\s\S]*Storage\.definirAppAgendamentoId/.test(fonte),
  "retorno do SPI volta para o registro local");
ok(/aoVincularGoogleEvento:[\s\S]*Storage\.definirGoogleEventId/.test(fonte),
  "retorno do Google volta para o registro local");
ok(/Integracoes\.agendarCancelamentoSpi/.test(rotaCancelar) || /enfileirarCancelamentoDuravel\(removido\)/.test(rotaCancelar),
  "rota agenda cancelamento SPI em vez de chamada única");
ok(/Integracoes\.agendarCancelamentoGoogle/.test(rotaCancelar) || /enfileirarCancelamentoDuravel\(removido\)/.test(rotaCancelar),
  "rota agenda cancelamento Google em vez de chamada única");
ok(!/GoogleAgenda\.cancelarEvento|AppAgenda\.cancelarAgendamento/.test(rotaCancelar),
  "rota não executa integração externa one-shot");
ok(/listarCancelamentosPendentesDeFila/.test(fonte) && /marcarCancelamentoEnfileirado/.test(fonte),
  "queda entre banco e fila é recuperável");
ok(/Integracoes\.iniciarReconciliacao\(\)/.test(fonte),
  "painel vivo reconcilia a caixa mesmo com o bot desligado");
ok(/function definirGoogleEventId/.test(storage) && /definirGoogleEventId/.test(storage.slice(storage.lastIndexOf("module.exports"))),
  "storage exporta o vínculo durável do Google");

console.log(`painel-integracoes-duraveis: ${passou} passaram, ${falhas.length} falharam`);
if (falhas.length) {
  falhas.forEach((falha) => console.log("  FALHOU: " + falha));
  process.exit(1);
}
