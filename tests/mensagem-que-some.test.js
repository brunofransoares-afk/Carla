/*
 * Bateria da mensagem que sumia sem deixar rastro.
 *
 * O bot olhava exatamente dois lugares pra achar o texto:
 *
 *   msg.message.conversation || msg.message.extendedTextMessage?.text || ""
 *
 * e logo abaixo fazia `if (!texto.trim()) continue;`. SEM LOG NENHUM. Qualquer outro formato
 * sumia sem aparecer no pm2 logs: era impossível distinguir "essa família nunca escreveu" de
 * "essa família escreveu e a Carla não viu".
 *
 * QUEM CAÍA NO BURACO:
 *
 *  - MENSAGEM TEMPORÁRIA. É opção de QUEM ENVIA. Uma família com "mensagens temporárias"
 *    ligado ficava invisível pro consultório, para sempre, sem ninguém descobrir por quê.
 *    Esta é a provável explicação do contato de 10/08 que nunca foi respondido.
 *
 *  - FOTO COM LEGENDA. Mãe manda a foto da mancha escrevendo "olha isso aqui". A legenda
 *    mora em imageMessage.caption e nunca foi lida.
 *
 *  - VER UMA VEZ, DOCUMENTO COM LEGENDA, MENSAGEM EDITADA: mesma história.
 *
 * Roda com:  node tests/mensagem-que-some.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const RAIZ = path.join(__dirname, "..");
const T = require(path.join(RAIZ, "texto-da-mensagem.js"));
const SERVER = fs.readFileSync(path.join(RAIZ, "server.js"), "utf8");
// Sem os comentários: o próprio comentário do conserto CITA a linha antiga pra explicar o
// que mudou, e uma trava que procura essa linha casaria com a explicação em vez do código.
const SERVER_SEM_COMENTARIO = SERVER.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// ------------------------------------------------- 1. o que já funcionava continua
{
  eq(T.textoDe({ conversation: "Bom dia" }), "Bom dia", "1. texto simples");
  eq(T.textoDe({ extendedTextMessage: { text: "quanto custa?" } }), "quanto custa?", "1b. texto com citação/link");
}

// ------------------------------------------------- 2. mensagem temporária, o caso principal
{
  eq(T.textoDe({ ephemeralMessage: { message: { conversation: "oi, tem horário?" } } }),
    "oi, tem horário?", "2. temporária com texto simples dentro");
  eq(T.textoDe({ ephemeralMessage: { message: { extendedTextMessage: { text: "e amanhã?" } } } }),
    "e amanhã?", "2b. temporária com texto estendido dentro");
  eq(T.textoDe({ ephemeralMessage: { message: { imageMessage: { caption: "a mancha" } } } }),
    "a mancha", "2c. temporária com foto legendada dentro");
}

// ------------------------------------------------- 3. legenda é texto
{
  // Quem manda foto escrevendo "olha isso" escreveu. Isso sumia inteiro.
  eq(T.textoDe({ imageMessage: { caption: "olha essa mancha na perna dele" } }),
    "olha essa mancha na perna dele", "3. legenda de foto");
  eq(T.textoDe({ videoMessage: { caption: "o barulho que ele faz" } }),
    "o barulho que ele faz", "3b. legenda de vídeo");
  eq(T.textoDe({ documentMessage: { caption: "o exame dele" } }), "o exame dele", "3c. legenda de documento");
}

// ------------------------------------------------- 4. os outros embrulhos
{
  eq(T.textoDe({ viewOnceMessage: { message: { conversation: "some depois" } } }), "some depois", "4. ver uma vez");
  eq(T.textoDe({ viewOnceMessageV2: { message: { conversation: "v2" } } }), "v2", "4b. ver uma vez v2");
  eq(T.textoDe({ viewOnceMessageV2Extension: { message: { conversation: "v2e" } } }), "v2e", "4c. ver uma vez v2 ext");
  eq(T.textoDe({ documentWithCaptionMessage: { message: { documentMessage: { caption: "exame" } } } }),
    "exame", "4d. documento com legenda");
  eq(T.textoDe({ protocolMessage: { editedMessage: { conversation: "corrigi o que escrevi" } } }),
    "corrigi o que escrevi", "4e. mensagem editada");
  eq(T.textoDe({ templateMessage: { hydratedTemplate: { hydratedContentText: "Quero este horário" } } }),
    "Quero este horário", "4f. texto de modelo comercial hidratado");
  eq(T.textoDe({ orderMessage: { message: "pedido da família" } }),
    "pedido da família", "4g. observação de pedido comercial");
}

// ------------------------------------------------- 5. embrulho dentro de embrulho
{
  // Acontece de verdade: quem usa mensagem temporária e manda "ver uma vez" junto.
  eq(T.textoDe({ ephemeralMessage: { message: { viewOnceMessageV2: { message: { conversation: "duas camadas" } } } } }),
    "duas camadas", "5. desembrulha em cascata");

  // E não pode entrar em laço infinito com mensagem malformada.
  const infinito = {};
  infinito.ephemeralMessage = { message: infinito };
  let estourou = false;
  try { T.textoDe(infinito); } catch { estourou = true; }
  ok(!estourou, "5b. embrulho circular não derruba o processo");
  eq(T.MAX_CAMADAS, 5, "5c. com teto de camadas explícito");
}

// ------------------------------------------------- 6. o que NÃO é texto continua não sendo
{
  eq(T.textoDe({ imageMessage: {} }), "", "6. foto sem legenda não inventa texto");
  eq(T.textoDe({ stickerMessage: {} }), "", "6b. figurinha também não");
  eq(T.textoDe({ protocolMessage: { type: 0 } }), "", "6c. recado de sistema não é texto");
  eq(T.textoDe(null), "", "6d. nulo não estoura");
  eq(T.textoDe({}), "", "6e. vazio não estoura");
  eq(T.textoDe({ conversation: "   " }), "", "6f. só espaço não conta como texto");
}

// ------------------------------------------------- 7. separar sistema de mensagem perdida
{
  // Recado de sistema não pode virar aviso de "não consegui ler": entope o log e some com
  // o aviso que importa no meio do ruído.
  ok(T.ehRecadoDeSistema({ protocolMessage: { type: 0 } }), "7. apagar mensagem é recado de sistema");
  ok(T.ehRecadoDeSistema({ reactionMessage: {} }), "7b. reação também");
  ok(T.ehRecadoDeSistema({ senderKeyDistributionMessage: {} }), "7c. e chave de grupo");
  ok(!T.ehRecadoDeSistema({ protocolMessage: { editedMessage: { conversation: "x" } } }),
    "7d. mas mensagem EDITADA não é recado de sistema: ela tem texto de gente");
  ok(!T.ehRecadoDeSistema({ imageMessage: {} }), "7e. e foto também não");
  ok(T.ehRecadoDeSistema({ secretEncryptedMessage: {}, messageContextInfo: {} }),
    "7f. sincronização secreta é sistema, mesmo acompanhada do contexto");
}

// ------------------------------------------------- 8. mídia sem texto é caso à parte
{
  ok(T.ehMidiaSemTexto({ imageMessage: {} }), "8. foto sozinha");
  ok(T.ehMidiaSemTexto({ ephemeralMessage: { message: { stickerMessage: {} } } }), "8b. figurinha temporária");
  ok(!T.ehMidiaSemTexto({ imageMessage: { caption: "oi" } }), "8c. foto COM legenda não entra aqui: tem texto");
  ok(!T.ehMidiaSemTexto({ conversation: "oi" }), "8d. e texto puro também não");
}

// ------------------------------------------------- 9. o tipo aparece no log
{
  // Sem isso, o aviso de "não consegui ler" não diz o que era, e não dá pra consertar depois.
  eq(T.tipoDe({ ephemeralMessage: { message: { stickerMessage: {} } } }), "stickerMessage",
    "9. o tipo é o de DENTRO do embrulho, que é o que interessa");
  eq(T.tipoDe(null), "desconhecido", "9b. e nunca estoura");
  eq(T.classificar({ conversation: "oi" }).categoria, "texto", "9c. classificação única reconhece texto");
  eq(T.classificar({ imageMessage: {} }).categoria, "midia_sem_texto", "9d. separa mídia sem legenda");
  eq(T.classificar({ secretEncryptedMessage: {} }).categoria, "sistema", "9e. separa protocolo interno");
  eq(T.classificar({ pollCreationMessage: {} }).categoria, "nao_suportado",
    "9f. formato humano ainda não lido é explícito e não deve sumir");
}

// ------------------------------------------------- 10. o server usa isso, e desembrulha antes de tudo
{
  ok(/const conteudo = \(typeof normalizeMessageContent === "function"/.test(SERVER),
    "10. o server desembrulha o conteúdo");
  ok(/if \(conteudo\.audioMessage\)/.test(SERVER),
    "10b. e a checagem de áudio olha o desembrulhado: áudio de quem usa temporária passava batido");
  ok(/const texto = TextoDaMensagem\.textoDe\(conteudo\);/.test(SERVER),
    "10c. o texto sai do módulo, não de dois campos na mão");

  // A leitura antiga não pode voltar.
  ok(!/msg\.message\.conversation/.test(SERVER),
    "10d. a leitura antiga de msg.message.conversation não existe mais");
  ok(!/msg\.message\.extendedTextMessage/.test(SERVER),
    "10e. nem a de extendedTextMessage");
}

// ------------------------------------------------- 11. NADA mais some em silêncio
{
  // Este é o coração do conserto. Antes: `if (!texto.trim()) continue;` e acabou.
  const bloco = SERVER.slice(SERVER.indexOf("const texto = TextoDaMensagem.textoDe(conteudo);"),
                             SERVER.indexOf("[RECEBIDA]"));
  ok(/\[MÍDIA SEM TEXTO\]/.test(bloco), "11. mídia sem texto vira linha de log");
  ok(/console\.warn\(`\[SEM TEXTO\]/.test(bloco),
    "11b. e o que não deu pra ler vira AVISO, com o tipo junto");
  ok(/TextoDaMensagem\.tipoDe\(conteudo\)/.test(bloco), "11c. dizendo qual era o tipo");
  ok(/ehRecadoDeSistema/.test(bloco),
    "11d. e o recado de sistema sai antes, pra não encher o log de ruído");

  // Não pode existir um `continue` mudo antes dos logs.
  ok(!/if \(!texto\.trim\(\)\) continue;/.test(SERVER_SEM_COMENTARIO),
    "11e. o descarte silencioso não pode voltar");
}

console.log(`\nmensagem-que-some: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
