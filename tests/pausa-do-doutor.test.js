/**
 * Auditoria de 10/09, problemas 2 e 3, os dois na mesma função.
 *
 * 3: a tela promete "A Carla fica quieta nessa conversa até você retomar". O código
 * reaproveitava a espera da escalada, que termina sozinha em 2h: a Carla voltava a
 * responder sem ninguém clicar em Retomar. E marcar "a Carla continua a conversa" não
 * limpava uma pausa que já existia, então o convite saía, a família respondia, e a
 * resposta dela morria no silêncio.
 *
 * 2: o envio manual ficava FORA da fila por telefone. Se a Carla estivesse montando uma
 * resposta com a sessão lida antes, ela terminava depois e gravava o estado velho por
 * cima: a mensagem do Dr. Bruno sumia do histórico e a pausa junto.
 *
 * Aqui a decisão do silêncio é executada de verdade, com relógio de mentira.
 */
"use strict";
const fs = require("fs");
const path = require("path");
let passou = 0, falhou = 0; const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const STORAGE = fs.readFileSync(path.join(__dirname, "..", "storage-node.js"), "utf8");
const TELA = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");
const DUAS_HORAS = 2 * 60 * 60 * 1000;

// A decisão do passo 2 de processarMensagem, recortada e executada: fica quieta ou volta?
const bloco = SERVER.slice(SERVER.indexOf("  if (sessao.aguardandoHumano) {"), SERVER.indexOf("  // Antes de a IA rodar"));
function ficaQuieta(sessao, minutosDepois) {
  const now = new Date(Date.parse(sessao.aguardandoHumanoDesde || "2026-09-10T12:00:00.000Z") + minutosDepois * 60000);
  const corpo = bloco.replace(/console\.log\([^\n]*\);/g, "").replace("return;", "return true;");
  return new Function("sessao", "now", "AGUARDANDO_HUMANO_EXPIRA_MS", corpo + "\nreturn false;")(sessao, now, DUAS_HORAS) === true;
}
const pausaDoDoutor = () => ({ aguardandoHumano: true, aguardandoHumanoDesde: "2026-09-10T12:00:00.000Z", pausadaPeloDoutor: true });
const esperaDaEscalada = () => ({ aguardandoHumano: true, aguardandoHumanoDesde: "2026-09-10T12:00:00.000Z", pausadaPeloDoutor: false });

// ------------------------------------------------- 1. a pausa do doutor não termina sozinha
{
  ok(ficaQuieta(pausaDoDoutor(), 1), "1. um minuto depois da mensagem manual, a Carla está quieta");
  ok(ficaQuieta(pausaDoDoutor(), 121), "1b. 121 minutos depois, continua quieta (antes ela voltava sozinha aqui)");
  ok(ficaQuieta(pausaDoDoutor(), 60 * 24 * 7), "1c. uma semana depois, continua quieta: só o botão Retomar desfaz");
}

// ------------------------------------------------- 2. a espera da escalada continua expirando em 2h
{
  ok(ficaQuieta(esperaDaEscalada(), 119), "2. antes das 2h, quieta");
  ok(!ficaQuieta(esperaDaEscalada(), 121), "2b. depois das 2h, volta sozinha: sem isso uma escalada esquecida travava a conversa pra sempre");
  ok(ficaQuieta({ aguardandoHumano: true, aguardandoHumanoDesde: null, pausadaPeloDoutor: false }, 5), "2c. espera de escalada sem data guardada continua quieta, como antes: sem data não há o que expirar");
  ok(!ficaQuieta({ aguardandoHumano: false }, 99999), "2d. sem pausa nenhuma, a Carla responde");
}

// ------------------------------------------------- 3. quem cria e quem desfaz a pausa
{
  const manual = SERVER.slice(SERVER.indexOf("async function mensagemManualNaFila("), SERVER.indexOf("async function processarMensagem("));
  ok(/sessao\.pausadaPeloDoutor = true;/.test(manual), "3. a mensagem manual cria a pausa do doutor");
  ok(/if \(carlaContinua\) \{[\s\S]*?sessao\.aguardandoHumano = false;[\s\S]*?sessao\.aguardandoHumanoDesde = null;[\s\S]*?sessao\.pausadaPeloDoutor = false;/.test(manual), "3b. e 'a Carla continua' LIMPA a pausa que já existia, em vez de só não criar outra");
  ok(/sessao\.pausadaPeloDoutor = false;\s*\n\s*return true;/.test(STORAGE) && /function retomarAtendimento/.test(STORAGE), "3c. o botão Retomar do painel desfaz a pausa");
  const escalada = SERVER.slice(SERVER.indexOf("async function responderEscaladaNaFila("), SERVER.indexOf("const gatilho ="));
  ok(/sessao\.pausadaPeloDoutor = false;/.test(escalada), "3d. responder a escalada também devolve a conversa pra Carla");
  ok(/pausadaPeloDoutor: false,/.test(SERVER.slice(SERVER.indexOf("function sessaoPadrao("), SERVER.indexOf("function normalizarSessao("))), "3e. a sessão nasce sem pausa");
}

// ------------------------------------------------- 4. o envio manual roda na fila do telefone
{
  const porta = SERVER.slice(SERVER.indexOf("async function mensagemManual(telefone"), SERVER.indexOf("async function mensagemManualNaFila("));
  ok(/return filaMensagens\.enfileirar\(telefone, \(\) => mensagemManualNaFila\(telefone, limpo, carlaContinua\)\);/.test(porta), "4. o envio manual entra na fila daquele telefone");
  ok(!/Storage\.salvarSessao|normalizarSessao/.test(porta), "4b. e nada de sessão acontece fora da fila");
  const naFila = SERVER.slice(SERVER.indexOf("async function mensagemManualNaFila("), SERVER.indexOf("async function processarMensagem("));
  const leSessao = naFila.indexOf("normalizarSessao(telefone, Storage.obterSessao(telefone))");
  const grava = naFila.indexOf("Storage.salvarSessao(telefone, sessao);");
  const envia = naFila.indexOf("await enviarResposta(");
  ok(leSessao > 0 && grava > leSessao && envia > grava, "4c. dentro da fila: lê a sessão, grava, e só então envia");
  ok(/if \(!sockAtivo\) return \{ ok: false, motivo: "WhatsApp desconectado\." \};/.test(naFila), "4d. e confere o WhatsApp de novo lá dentro: a espera na fila pode ter derrubado a conexão");
}

// ------------------------------------------------- 5. contato silenciado: a tela não promete o que o bot não faz
{
  const naFila = SERVER.slice(SERVER.indexOf("async function mensagemManualNaFila("), SERVER.indexOf("async function processarMensagem("));
  ok(/const carlaVaiResponder = carlaContinua && !Storage\.contatoSilenciado\(telefone\);/.test(naFila), "5. silenciado no painel vence a caixa marcada: o silêncio é decisão explícita");
  ok(/return \{ ok: true, carlaVaiResponder, silenciado: Storage\.contatoSilenciado\(telefone\) \};/.test(naFila), "5b. e quem chamou recebe isso na resposta, em vez de descobrir pelo silêncio");
  const passoSilencio = SERVER.indexOf("if (Storage.contatoSilenciado(telefone)) {\n    console.log(`[IGNORADO — silenciado manualmente]");
  const passoPausa = SERVER.indexOf("  if (sessao.aguardandoHumano) {");
  ok(passoSilencio > 0 && passoSilencio < passoPausa, "5c. e no bot o silenciado é checado antes da pausa, que é o que faz isso ser verdade");
}

// ------------------------------------------------- 6. a tela continua prometendo o que agora acontece
{
  ok(/A Carla fica quieta nessa conversa até você retomar/.test(TELA), "6. a promessa está escrita na tela");
  ok(/btn-retomar-contato/.test(TELA), "6b. e o botão que a cumpre existe");
  ok(/if \(carlaContinua && r\.silenciado\) \{[\s\S]*?A Carla NÃO vai responder: este número está silenciado no painel\./.test(TELA), "6c. e quando a caixa marcada não vale (número silenciado), a tela diz, em vez de deixar você esperando");
}

console.log(`\npausa-do-doutor: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
