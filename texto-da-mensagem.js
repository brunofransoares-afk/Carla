"use strict";

// De onde sai o texto que a família escreveu.
//
// O QUE ESTAVA ERRADO. O bot olhava exatamente dois lugares:
//
//   msg.message.conversation  ||  msg.message.extendedTextMessage?.text  ||  ""
//
// e logo abaixo fazia `if (!texto.trim()) continue;`. Sem log, sem alerta, sem nada. Todo
// formato de mensagem que não fosse um desses dois sumia sem deixar rastro: no `pm2 logs`
// não aparecia nem que a mensagem tinha chegado.
//
// QUEM CAÍA NESSE BURACO:
//
//  - MENSAGEM TEMPORÁRIA. Quem tem "mensagens temporárias" ligado no WhatsApp manda tudo
//    embrulhado em ephemeralMessage. O texto está lá dentro, intacto. A Carla nunca via.
//    Isso é opção do REMETENTE, então uma família inteira pode ser invisível pro consultório
//    sem ninguém nunca descobrir por quê.
//
//  - FOTO COM LEGENDA. Mãe manda foto da mancha na pele escrevendo "olha isso aqui". A
//    legenda mora em imageMessage.caption, que não era lido. Some.
//
//  - VER UMA VEZ, e documento com legenda: mesma história, outro embrulho.
//
//  - MENSAGEM EDITADA: o WhatsApp manda a versão nova dentro de um protocolMessage.
//
// COMO RESOLVE. Desembrulha recursivamente (embrulho dentro de embrulho acontece: temporária
// + ver uma vez, por exemplo) e depois procura o texto em todos os lugares onde ele pode
// estar, legenda inclusive.
//
// POR QUE NÃO DEPENDER DO normalizeMessageContent DO BAILEYS. Ele existe e desembrulha os
// containers, mas (a) não extrai legenda, que é metade do problema, e (b) o módulo dele puxa
// o pacote inteiro, e aí esta lógica não roda em teste sem instalar o WhatsApp junto. O
// server passa o conteúdo já normalizado pelo Baileys QUANDO essa função existe, e este
// módulo desembrulha de novo por conta própria: as duas coisas são idempotentes, e assim a
// regra continua verificável sozinha.

// Camadas que embrulham OUTRA mensagem dentro. A ordem não importa; o desembrulho é em laço.
const EMBRULHOS = [
  "ephemeralMessage",           // mensagens temporárias (opção de quem envia)
  "viewOnceMessage",            // ver uma vez
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage", // documento com legenda
  "editedMessage",              // edição, em algumas versões
];

// Teto de segurança: mensagem malformada (ou maliciosa) com embrulho aninhado sem fim não
// pode prender o processo num laço. Cinco é muito mais do que o WhatsApp usa de verdade.
const MAX_CAMADAS = 5;

function desembrulhar(conteudo) {
  let atual = conteudo;
  for (let i = 0; i < MAX_CAMADAS; i++) {
    if (!atual || typeof atual !== "object") return atual;

    const embrulho = EMBRULHOS.find((nome) => atual[nome] && atual[nome].message);
    if (embrulho) { atual = atual[embrulho].message; continue; }

    // Mensagem editada: o conteúdo novo vem pendurado no protocolMessage. Repare que
    // protocolMessage SEM editedMessage é recado de sistema (apagar mensagem, etc) e não
    // tem texto nenhum: aquele caso cai fora daqui e é tratado como "sem texto", não como
    // mensagem perdida.
    if (atual.protocolMessage && atual.protocolMessage.editedMessage) {
      atual = atual.protocolMessage.editedMessage;
      continue;
    }
    return atual;
  }
  return atual;
}

// Onde o texto pode estar, depois de desembrulhado. Legenda conta como texto: quem manda
// foto escrevendo "olha isso" escreveu.
function textoDe(conteudo) {
  const c = desembrulhar(conteudo);
  if (!c || typeof c !== "object") return "";
  const candidatos = [
    c.conversation,
    c.extendedTextMessage && c.extendedTextMessage.text,
    c.imageMessage && c.imageMessage.caption,
    c.videoMessage && c.videoMessage.caption,
    c.documentMessage && c.documentMessage.caption,
    // Resposta a enquete e escolha de lista/botão: é a família respondendo com palavras que
    // ela escolheu, mesmo sem digitar.
    c.buttonsResponseMessage && c.buttonsResponseMessage.selectedDisplayText,
    c.listResponseMessage && c.listResponseMessage.title,
    c.templateButtonReplyMessage && c.templateButtonReplyMessage.selectedDisplayText,
  ];
  for (const t of candidatos) {
    if (typeof t === "string" && t.trim()) return t;
  }
  return "";
}

// O que veio, quando não veio texto. Serve pro log: sem isto a mensagem some sem rastro e
// não há como descobrir depois por que uma família ficou sem resposta.
function tipoDe(conteudo) {
  const c = desembrulhar(conteudo);
  if (!c || typeof c !== "object") return "desconhecido";
  const chaves = Object.keys(c).filter((k) => c[k] != null);
  return chaves.length ? chaves.join("+") : "vazio";
}

// Recado de sistema (apagou mensagem, mudou config de temporária, sincronização). Não é
// mensagem de gente e não pode virar aviso de "não consegui ler": encheria o log de ruído.
function ehRecadoDeSistema(conteudo) {
  const c = desembrulhar(conteudo);
  if (!c || typeof c !== "object") return false;
  if (c.protocolMessage && !c.protocolMessage.editedMessage) return true;
  if (c.senderKeyDistributionMessage && Object.keys(c).length === 1) return true;
  if (c.messageContextInfo && Object.keys(c).length === 1) return true;
  if (c.reactionMessage) return true;
  return false;
}

// Mídia sem nenhum texto junto: foto sozinha, figurinha, documento sem legenda. Existe de
// verdade e a família ESCREVEU nada, então não é mensagem perdida — mas o Dr. Bruno precisa
// saber que chegou, porque hoje ninguém responde isso.
function ehMidiaSemTexto(conteudo) {
  const c = desembrulhar(conteudo);
  if (!c || typeof c !== "object") return false;
  if (textoDe(conteudo)) return false;
  return !!(c.imageMessage || c.videoMessage || c.stickerMessage || c.documentMessage);
}

module.exports = { textoDe, tipoDe, desembrulhar, ehRecadoDeSistema, ehMidiaSemTexto, EMBRULHOS, MAX_CAMADAS };
