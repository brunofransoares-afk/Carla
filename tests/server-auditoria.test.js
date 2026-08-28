"use strict";

const fs = require("fs");
const path = require("path");

const fonte = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
let passou = 0;
const erros = [];
function ok(condicao, mensagem) {
  if (condicao) passou++;
  else erros.push(mensagem);
}

ok(/criarIntegracoesDuraveis\(\{[\s\S]*Storage\.definirAppAgendamentoId[\s\S]*Storage\.definirGoogleEventId/.test(fonte),
  "integrações duráveis não estão ligadas aos IDs locais");
ok(/integracoes\.iniciarReconciliacao\(\)/.test(fonte), "reconciliador externo não inicia");
ok(/const slotId = acao\?\.slotId \|\| acao\?\.agendamento\?\.slotId \|\| acao\?\.slot\?\.id/.test(fonte),
  "efeitos não priorizam o ID único da reserva");
ok(/integracoes\.agendarCriacaoSpi/.test(fonte) && /integracoes\.agendarCriacaoGoogle/.test(fonte),
  "reserva não cria os dois efeitos externos");
ok(/integracoes\.registrarDadosPaciente/.test(fonte), "dados do paciente não entram na caixa de efeitos");
ok(/integracoes\.agendarCancelamentoSpi/.test(fonte) && /integracoes\.agendarCancelamentoGoogle/.test(fonte),
  "cancelamento não limpa as duas integrações");
ok(/listarVencimentosPendentesDeLimpeza[\s\S]*marcarVencimentoSincronizado/.test(fonte),
  "reservas vencidas não têm reconciliação periódica");
ok(/async function reconciliarReservasAtivasSemEfeito/.test(fonte)
  && /filter\(\(a\) => a\.integracoesDuraveis\)/.test(fonte)
  && /await reconciliarReservasAtivasSemEfeito\(\)/.test(fonte),
  "queda entre a reserva local e a caixa de efeitos deixa integração externa perdida");

const chamadasEstado = fonte.match(/estadoAtendimento: sessao\.estadoAtendimento/g) || [];
const chamadasTriagem = fonte.match(/triagemPendente: sessao\.triagemPendente/g) || [];
ok(chamadasEstado.length >= 3 && chamadasTriagem.length >= 3,
  "estado explícito não acompanha todos os caminhos de IA");
ok(/TriagemEmergencia\.respostaConfirmaPerigo\(texto\)/.test(fonte)
  && /sessao\.triagemPendente = \{[\s\S]*termo: avaliacaoEmergencia\.termo/.test(fonte),
  "sinal ambíguo não fica pendente para confirmação determinística");
ok(/agendamentoAtual: resumoDeAgendamento\(consultaReal\)/.test(fonte),
  "cérebro ainda recebe consulta só do cache da sessão");
ok(/function precoParticularInformado[\s\S]*tipo: "registrar_preco"/.test(fonte),
  "preço não é validado no texto efetivamente entregue");

const posPendente = fonte.indexOf("const pendente = Storage.registrarMensagemPendente");
const posSemSocket = fonte.indexOf("if (!sock) return", posPendente);
ok(posPendente >= 0 && posSemSocket > posPendente,
  "queda do socket ainda acontece antes de persistir a resposta");
ok(/registrarNoHistorico: true/.test(fonte), "mensagens fixas não entram no histórico");
ok(/return filaMensagens\.enfileirar\(telefone, \(\) => reaquecerLeadNaFila/.test(fonte),
  "reaquecimento não passa pela fila do telefone");

const blocoAlerta = fonte.slice(
  fonte.indexOf("async function responderEscaladaNaFila"),
  fonte.indexOf("async function reaquecerLead"),
);
ok(blocoAlerta.indexOf("await enviarResposta") < blocoAlerta.indexOf("Storage.responderAlerta"),
  "alerta é fechado antes de a resposta ficar persistida");
ok(/LIMITE_CORPO_INTERNO_BYTES = 64 \* 1024/.test(fonte)
  && /LIMITE_TEXTO_ENTRADA/.test(fonte)
  && /LIMITE_MENSAGENS_POR_MINUTO/.test(fonte),
  "limites de entrada HTTP/WhatsApp não estão ativos");
ok((/processarFormatoNaoEntendido\(sock, jid, telefone, "midia"\)/.test(fonte)
    || /processarFormatoNaoEntendido\(conexao, jid, telefone, "midia"\)/.test(fonte))
  && (/processarFormatoNaoEntendido\(sock, jid, telefone, "desconhecido"\)/.test(fonte)
    || /processarFormatoNaoEntendido\(conexao, jid, telefone, "desconhecido"\)/.test(fonte)),
  "formato desconhecido ou mídia sem legenda ainda some em silêncio");
ok(/log-seguro\.js/.test(fonte) && fonte.indexOf("log-seguro.js") < fonte.indexOf("@whiskeysockets/baileys"),
  "logs seguros não são instalados antes das integrações");
ok(/function agendarReconexao/.test(fonte)
  && /Math\.min\(60000, 2000 \* \(2 \*\*/.test(fonte)
  && !/if \(deveReconectar\) iniciar\(\)/.test(fonte),
  "reconexão ainda abre sockets em cascata sem espera progressiva");
ok(/async function reconciliarPagamentosSemAviso/.test(fonte)
  && /await reconciliarPagamentosSemAviso\(\)/.test(fonte),
  "pagamento marcado com bot offline não é retomado ao reconectar");
ok(/uncaughtExceptionMonitor/.test(fonte) && /unhandledRejection/.test(fonte),
  "falha fatal não fica registrada antes do PM2 reiniciar");
ok(/const conexao = sockAtivo;[\s\S]*processarMensagem\(conexao, buffer\.jid/.test(fonte),
  "debounce ainda tenta responder pelo socket antigo depois de uma reconexão");
ok(/StatusWhatsapp\.registrar\("conectado"\)/.test(fonte)
  && /StatusWhatsapp\.registrar\(deveReconectar \? "reconectando" : "sessao_desconectada"\)/.test(fonte)
  && /timerStatusWhatsapp/.test(fonte),
  "painel ainda não recebe estado real e pulso da conexão do WhatsApp");

console.log(`server-auditoria: ${passou} passaram, ${erros.length} falharam`);
for (const erro of erros) console.log(`  FALHOU: ${erro}`);
process.exit(erros.length ? 1 : 0);
