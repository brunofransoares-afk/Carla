/*
 * Bateria de quando o sistema chama o Dr. Bruno.
 *
 * O bot já mandava WhatsApp pra ele em dois casos: agendamento novo e dados do portal. Os
 * dois casos que mais precisam dele NÃO mandavam nada.
 *
 * EMERGÊNCIA era o pior. A família lê, escrito na resposta dela: "Vou avisar o Dr. Bruno
 * sobre esse contato assim que possível." Ninguém era avisado. O alerta ficava parado no
 * painel esperando alguém abrir a tela por acaso. Uma mãe escrevendo que o filho não está
 * respirando recebia uma promessa que o sistema não cumpria.
 *
 * ESCALONAMENTO era o mesmo buraco, e ficou crítico quando a Carla passou a escalar pedido
 * de horário fora da grade: agora o pedido chega no lugar certo, mas o lugar certo precisava
 * chamar por ele. Pior ainda porque escalar SILENCIA a conversa por 2 horas: a família fica
 * esperando um retorno que só sairia se ele abrisse o painel por acaso.
 *
 * A DIFERENÇA ENTRE OS DOIS, que o aviso precisa dizer: emergência NÃO silencia (a Carla
 * continua respondendo, de propósito), escalonamento silencia. Sem isso ele pode achar que
 * tem tempo quando não tem, ou o contrário.
 *
 * Roda com:  node tests/chama-o-dr-bruno.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

// ------------------------------------------------- 1. os dois casos chamam
{
  ok(/async function notificarAtencao\(sock, \{ tipo, telefoneFamilia, texto, crianca, pergunta \}\)/.test(SERVER),
    "1. a função existe");
  ok(/notificarAtencao\(sock, \{ tipo: "emergencia"/.test(SERVER), "1b. emergência chama o Dr. Bruno");
  ok(/tipo: resultado\.escalarTipo === "comercial" \? "comercial" : "escalonamento"/.test(SERVER),
    "1c. escalonamento também, separando o comercial do resto");
  // "tipo:" com dois-pontos só aparece nas CHAMADAS; a definição da função usa "{ tipo," sem
  // valor. Contar sem isso pegava a própria definição e dava 3.
  eq((SERVER.match(/notificarAtencao\(sock, \{\s*\n?\s*tipo:/g) || []).length, 2,
    "1d. dois pontos de chamada: emergência e escalonamento");
}

// ------------------------------------------------- 2. a emergência avisa ANTES de responder
{
  // A resposta pra família tem 3 segundos de atraso artificial ("digitando") antes de sair.
  // Disparar o aviso antes disso põe ele a caminho primeiro, que é o que importa aqui.
  const posAviso = SERVER.indexOf('notificarAtencao(sock, { tipo: "emergencia"');
  const posResposta = SERVER.indexOf("await enviarResposta(sock, jid, telefone, respostaEmergencia, semAtraso);");
  ok(posAviso > 0 && posResposta > posAviso,
    "2. na emergência o Dr. Bruno é chamado antes de a resposta sair pra família");

  // E a promessa que a família lê continua lá, agora verdadeira.
  ok(/Vou avisar o Dr\. Bruno sobre esse contato assim que possível/.test(SERVER),
    "2b. a promessa continua no texto da emergência");
}

// ------------------------------------------------- 3. o aviso diz se a conversa parou ou não
{
  ok(/A Carla parou de responder essa conversa\. Ela volta sozinha em 2h se ninguém retornar\./.test(SERVER),
    "3. o aviso de escalonamento diz que a conversa está parada, e por quanto tempo");
  ok(/if \(tipo !== "emergencia"\) \{/.test(SERVER),
    "3b. e essa linha NÃO sai na emergência, porque ali a Carla continua respondendo");
}

// ------------------------------------------------- 4. nunca atrapalha a família
{
  // Mesmo desenho das duas notificações que já existiam. Avisar o Dr. Bruno é secundário:
  // se falhar, a família não pode nem perceber.
  const bloco = SERVER.slice(SERVER.indexOf("async function notificarAtencao"),
                             SERVER.indexOf("async function processarMensagem"));
  ok(/const telefoneDrBruno = \(process\.env\.DR_BRUNO_TELEFONE \|\| ""\)\.trim\(\);\r?\n  if \(!telefoneDrBruno\) return;/.test(bloco),
    "4. inerte sem DR_BRUNO_TELEFONE, igual às outras duas");
  ok(/catch \(erro\) \{/.test(bloco), "4b. o erro morre dentro da função");
  ok(/console\.error\("\[NOTIFICAÇÃO\] Erro ao chamar o Dr\. Bruno:"/.test(bloco),
    "4c. e fica no log, senão some sem rastro");

  // Fire-and-forget: as chamadas NÃO podem ter await, senão uma rede lenta segura a resposta
  // da família atrás do aviso.
  ok(!/await notificarAtencao\(/.test(SERVER), "4d. nunca é aguardada");
}

// ------------------------------------------------- 5. o aviso é útil de verdade
{
  const bloco = SERVER.slice(SERVER.indexOf("async function notificarAtencao"),
                             SERVER.indexOf("async function processarMensagem"));
  ok(/🚨 EMERGÊNCIA/.test(bloco), "5. a emergência se anuncia como emergência");
  ok(/⚠️ Precisa de você/.test(bloco), "5b. o escalonamento tem cabeçalho próprio");
  ok(/📩 Contato comercial/.test(bloco),
    "5c. e o comercial tem o dele: representante de laboratório não é urgência, e misturar os dois faz ele ignorar os dois");
  ok(/linhas\.push\(`Telefone: \$\{telefoneFamilia\}`\)/.test(bloco),
    "5d. leva o telefone da família, que é o que ele precisa pra responder");
  ok(/if \(crianca\) linhas\.push\(`Criança: \$\{crianca\}`\)/.test(bloco),
    "5e. e o nome da criança quando o sistema já sabe");
  ok(/\.slice\(0, 600\)/.test(bloco),
    "5f. com o texto cortado: mensagem gigante da família não pode virar um textão no WhatsApp dele");
}

// ------------------------------------------------- 6. as notificações antigas continuam
{
  ok(/notificarNovoAgendamento\(sock, acao, telefone\);/.test(SERVER), "6. agendamento novo continua avisando");
  ok(/notificarDadosDoPaciente\(sock, resultado\.dadosDoPaciente/.test(SERVER), "6b. dados do portal também");
  ok(/Storage\.registrarAlertaUrgencia\(\{ telefone, mensagem: texto, tipo: "emergencia" \}\)/.test(SERVER),
    "6c. e o alerta no painel continua sendo gravado: o WhatsApp é a mais, não no lugar de");
}

console.log(`\nchama-o-dr-bruno: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
