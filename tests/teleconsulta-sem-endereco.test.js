/**
 * Auditoria de 10/09, problema 11: a confirmação de pagamento e os lembretes mandavam
 * endereço, mapa, "o que levar" e aviso de atraso pra toda reserva, inclusive teleconsulta,
 * sem uma palavra sobre vídeo. Agora as instruções seguem a modalidade da reserva.
 */
"use strict";
const fs = require("fs");
const path = require("path");
let passou = 0, falhou = 0; const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const I = require(path.join(__dirname, "..", "instrucoes-da-consulta.js"));
const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const links = { endereco: "Rua X, 1", linkMapa: "https://maps/x", linkTeleconsulta: null };
const presencial = { modalidade: "presencial", crianca: "Ana" };
const tele = { modalidade: "teleconsulta", crianca: "Ana" };
const semModalidade = { crianca: "Ana" };

// ------------------------------------------------- 1. o módulo, executado
{
  eq(I.nomeDaConsulta(tele), "teleconsulta", "1. a frase diz teleconsulta");
  eq(I.nomeDaConsulta(presencial) + "|" + I.nomeDaConsulta(semModalidade) + "|" + I.nomeDaConsulta(null), "consulta|consulta|consulta", "1b. presencial, sem modalidade e sem reserva: consulta");
  eq(I.blocoDoLocal(presencial, links), "Endereço: Rua X, 1\nhttps://maps/x", "1c. presencial: endereço e mapa");
  eq(I.blocoDoLocal(tele, links), "A consulta é por vídeo, no horário combinado.\nO link da chamada chega por aqui antes da consulta.", "1d. teleconsulta sem link configurado: diz que é por vídeo e que o link chega por aqui");
  eq(I.blocoDoLocal(tele, { ...links, linkTeleconsulta: " https://meet/abc " }), "A consulta é por vídeo, no horário combinado.\nLink da chamada: https://meet/abc", "1e. com LINK_TELECONSULTA, o link já vai na mensagem");
  ok(!/Endereço|maps/.test(I.blocoDoLocal(tele, links)), "1f. teleconsulta nunca leva endereço nem mapa");
  eq(I.blocoDoQueLevar(presencial), I.O_QUE_LEVAR, "1g. presencial: o que levar");
  eq(I.blocoDoQueLevar(tele), "Deixa por perto: carteira de vacinação, exames recentes se tiver, e os remédios que a criança usa.", "1h. por vídeo não se leva nada: deixa por perto");
  eq(I.avisoDeAtraso(presencial, "confirmacao"), "Se precisar remarcar ou for atrasar, é só me avisar por aqui.", "1i. presencial: remarcar ou atrasar");
  eq(I.avisoDeAtraso(tele, "confirmacao"), "Se precisar remarcar, é só me avisar por aqui.", "1j. por vídeo não existe atraso de deslocamento: só remarcar");
  eq(I.avisoDeAtraso(presencial, "dia"), "Se for atrasar, me avisa por aqui. Até já! 😊", "1k. lembrete do dia, presencial");
  eq(I.avisoDeAtraso(tele, "dia"), "Se precisar remarcar, me avisa por aqui. Até já! 😊", "1l. lembrete do dia, por vídeo");
}

// ------------------------------------------------- 2. as três mensagens do bot usam o módulo, com a reserva
{
  const confirmacao = SERVER.slice(SERVER.indexOf("const texto = `Pagamento recebido!"), SERVER.indexOf("registrarPagamentoNaSessao(a.telefone, a);"));
  ok(/A \$\{Instrucoes\.nomeDaConsulta\(a\)\} de \$\{primeiroNome\(a\.crianca\)\} está confirmada/.test(confirmacao), "2. a confirmação diz consulta ou teleconsulta");
  ok(/\$\{Instrucoes\.blocoDoLocal\(a, \{ endereco: ENDERECO_CONSULTORIO, linkMapa: LINK_MAPA, linkTeleconsulta: LINK_TELECONSULTA \}\)\}/.test(confirmacao), "2b. local pela modalidade");
  ok(/\$\{Instrucoes\.blocoDoQueLevar\(a\)\}\$\{pedido\}/.test(confirmacao) && /\$\{Instrucoes\.avisoDeAtraso\(a, "confirmacao"\)\}/.test(confirmacao), "2c. o que levar e o aviso pela modalidade, e o pedido de e-mail e data continua");
  ok(!/Endereço: Rua Ranulpho|O_QUE_LEVAR|Se precisar remarcar ou for atrasar/.test(confirmacao), "2d. nada fixo de presencial sobrou na confirmação");
  const lembretes = SERVER.slice(SERVER.indexOf("async function enviarLembretes("), SERVER.indexOf("let sockAtivo = null;"));
  ok(/Passando pra lembrar que a \$\{Instrucoes\.nomeDaConsulta\(a\)\} de[^`]*\$\{Instrucoes\.blocoDoQueLevar\(a\)\}/.test(lembretes), "2e. lembrete da semana: nome e o que levar pela modalidade");
  ok(/hoje é o dia da \$\{Instrucoes\.nomeDaConsulta\(a\)\} de[^`]*\$\{Instrucoes\.blocoDoLocal\(a, \{ endereco: CARLA_CONFIG\.endereco, linkMapa: LINK_MAPA, linkTeleconsulta: LINK_TELECONSULTA \}\)\}[^`]*\$\{Instrucoes\.blocoDoQueLevar\(a\)\}[^`]*\$\{Instrucoes\.avisoDeAtraso\(a, "dia"\)\}/.test(lembretes), "2f. lembrete do dia: local, o que levar e aviso pela modalidade");
  ok(!/Endereço: \$\{CARLA_CONFIG\.endereco\}\\n\$\{LINK_MAPA\}\\n\\n\$\{O_QUE_LEVAR\}/.test(lembretes), "2g. o bloco fixo de presencial saiu do lembrete do dia");
  ok(/const LINK_TELECONSULTA = String\(process\.env\.LINK_TELECONSULTA \|\| ""\)\.trim\(\) \|\| null;/.test(SERVER), "2h. LINK_TELECONSULTA vem do .env e é opcional");
  ok(/const Instrucoes = require\(path\.join\(__dirname, "instrucoes-da-consulta\.js"\)\);/.test(SERVER), "2i. o bot carrega o módulo");
}

// ------------------------------------------------- 3. a mensagem inteira, montada como o bot monta
{
  const monta = (a) => `Pagamento recebido! 😊\n\nA ${I.nomeDaConsulta(a)} de ${a.crianca} está confirmada para ${a.diaLabel}.\n\n${I.blocoDoLocal(a, { endereco: "Rua Ranulpho Alvarenga Ferreira, 61", linkMapa: "https://maps/x", linkTeleconsulta: null })}\n\n${I.blocoDoQueLevar(a)}\n\n${I.avisoDeAtraso(a, "confirmacao")}`;
  const t = monta({ modalidade: "teleconsulta", crianca: "Davi", diaLabel: "terça 15/09 às 20:00" });
  ok(/A teleconsulta de Davi está confirmada para terça 15\/09 às 20:00\./.test(t) && /por vídeo/.test(t) && !/Ranulpho|maps|O que levar|atrasar/.test(t), "3. teleconsulta: vídeo, sem endereço, sem mapa, sem 'o que levar', sem atraso");
  const p = monta({ modalidade: "presencial", crianca: "Davi", diaLabel: "sábado 12/09 às 09:00" });
  ok(/A consulta de Davi está confirmada/.test(p) && /Ranulpho/.test(p) && /O que levar/.test(p) && !/vídeo/.test(p), "3b. presencial: igual a antes");
}

console.log(`\nteleconsulta-sem-endereco: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
