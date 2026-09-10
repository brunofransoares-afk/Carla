/*
 * Bateria da mensagem manual e do campo que sumia.
 *
 * O CAMPO QUE SUMIA. O painel redesenha a lista de alertas inteira a cada 8 segundos com
 * innerHTML. O campo de resposta à escalada era recriado no meio da digitação e o texto ia
 * embora. A lista de contatos tem o mesmo ciclo, e a caixa de mensagem nova mora dentro dela:
 * sem a mesma proteção, ela teria o mesmo defeito no dia em que nascesse.
 *
 * A MENSAGEM MANUAL. Não existia caixa de "mensagem pro paciente". O que existia era a
 * resposta à escalada, que a Carla lê e reescreve do jeito dela. Agora existe uma caixa em
 * cada contato: sai pelo número do consultório, crua, sem a IA no meio. E AO MANDAR, A CARLA
 * CALA naquela conversa (o mesmo estado da escalada) até o Dr. Bruno retomar o automático.
 * Sem isso a família recebia duas vozes do mesmo número.
 *
 * Roda com:  node tests/mensagem-manual.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const LER = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const SERVER = LER("server.js"), PAINEL = LER("painel-server.js"), TELA = LER("dashboard.html");
const JS = TELA.match(/<script>([\s\S]*)<\/script>/)[1];

// ------------------------------------------------- 1. o campo não some mais
{
  ok(/function alguemDigitandoEm\(seletor\)/.test(JS), "1. existe a checagem de 'alguém digitando'");
  ok(/c === document\.activeElement \|\| \(c\.value \|\| ""\)\.trim\(\)/.test(JS),
    "1b. e ela olha foco OU texto: campo com texto e sem foco também não pode ser apagado");
  ok(/if \(alguemDigitandoEm\("#lista-alertas input\[data-alerta-texto\]"\)\) \{/.test(JS),
    "1c. a lista de alertas não redesenha enquanto o campo de resposta está em uso");
  ok(/if \(!alguemDigitandoEm\("#lista-alertas input\[data-alerta-texto\]"\)\) ligarBotoesDeEscalada\(\);/.test(JS),
    "1d. e não religa os botões (que duplicaria o Enter) quando não redesenhou");
  // A caixa de mensagem mudou de casa com o CRM: saiu do cartão da lista e foi pra FICHA da
  // família, junto com a nota e a etiqueta. A proteção foi junto, e cobre os três campos.
  ok(/if \(!forcar && alguemDigitandoEm\("#ficha-contato textarea, #ficha-contato input"\)\) return;/.test(JS),
    "1e. a ficha da família tem a mesma proteção, porque a caixa de mensagem mora nela");
  // A proteção precisa vir ANTES do innerHTML, senão é decoração.
  const posGuarda = JS.indexOf('alguemDigitandoEm("#lista-alertas input[data-alerta-texto]")');
  const posInner = JS.indexOf("lista.innerHTML = alertas.map(");
  ok(posGuarda > 0 && posInner > posGuarda, "1f. a proteção vem antes do redesenho, não depois");
}

// ------------------------------------------------- 2. a caixa existe, em cada contato
{
  ok(/class="btn-mensagem-contato" data-telefone=/.test(JS), "2. cada contato tem o botão Mensagem");
  ok(/class="msg-manual" data-caixa=/.test(JS) && /<textarea rows="3"/.test(JS), "2b. e uma caixa própria, com textarea");
  ok(/A Carla fica quieta nessa conversa até você retomar/.test(JS),
    "2c. o placeholder avisa que a Carla vai calar: isso não pode ser surpresa");
  ok(/e\.key === "Enter" && \(e\.ctrlKey \|\| e\.metaKey\)/.test(JS),
    "2d. Ctrl+Enter envia; Enter sozinho é parágrafo, como no WhatsApp");
  ok(/fetch\("\/api\/mensagem-manual"/.test(JS), "2e. envia pela rota do painel");
  ok(/botao\.disabled = true;\s*\n\s*botao\.textContent = "Enviando\.\.\.";/.test(JS), "2f. o botão trava enquanto envia, contra duplo clique");
  ok(/aviso\.textContent = "Não enviou: " \+ \(r\.motivo/.test(JS), "2g. e a recusa aparece na própria caixa, com o motivo");
}

// ------------------------------------------------- 3. o painel só encaminha
{
  ok(/encaminharAoBot\("\/interno\/mensagem-manual", JSON\.stringify\(\{ telefone: corpo\.telefone, texto: corpo\.texto, carlaContinua: corpo\.carlaContinua === true \}\)\)/.test(PAINEL),
    "3. o painel encaminha pro bot, que é quem tem o WhatsApp");
  ok(/req\.url === "\/interno\/mensagem-manual"/.test(SERVER), "3b. e o bot atende nessa rota");
}

// ------------------------------------------------- 4. a Carla cala, e cala ANTES de enviar
{
  const bloco = SERVER.slice(SERVER.indexOf("async function mensagemManual("), SERVER.indexOf("async function processarMensagem("));
  ok(/sessao\.aguardandoHumano = true;/.test(bloco), "4. a conversa entra em atendimento humano");
  const posCala = bloco.indexOf("sessao.aguardandoHumano = true;");
  const posEnvia = bloco.indexOf("await enviarResposta(");
  ok(posCala > 0 && posEnvia > posCala, "4b. e cala ANTES do envio: se a família responder no segundo seguinte, a Carla já está quieta");
  ok(/Storage\.salvarSessao\(telefone, sessao\);/.test(bloco.slice(0, posEnvia)), "4c. gravado antes de mandar");
}

// ------------------------------------------------- 5. o texto entra como fala do consultório, nunca da família
{
  const bloco = SERVER.slice(SERVER.indexOf("async function mensagemManual("), SERVER.indexOf("async function processarMensagem("));
  ok(/\{ role: "assistant", content: limpo \}/.test(bloco), "5. entra no histórico como turno do consultório");
  ok(!/\{ role: "user", content: limpo \}/.test(bloco), "5b. NUNCA como turno da família: isso seria a Carla achando que a mãe disse aquilo");
  ok(/\.slice\(-24\)/.test(bloco), "5c. com o mesmo teto de 24 turnos do resto");
}

// ------------------------------------------------- 6. sai crua e sem a IA
{
  const bloco = SERVER.slice(SERVER.indexOf("async function mensagemManual("), SERVER.indexOf("async function processarMensagem("));
  ok(!/CerebroIA\./.test(bloco), "6. não passa pela IA");
  ok(/await enviarResposta\(sockAtivo, jid, telefone, limpo, true, \{/.test(bloco), "6b. manda o texto como veio, sem atraso de digitação");
  ok(/chaveIdempotencia: `manual:\$\{telefone\}:\$\{agora\.getTime\(\)\}`/.test(bloco), "6c. com chave própria: a caixa de saída não manda duas vezes");
  ok(/Eventos\.registrar\("mensagem_manual", telefone/.test(bloco), "6d. e o funil sabe que o Dr. Bruno entrou na conversa");
}

// ------------------------------------------------- 7. as travas
{
  const bloco = SERVER.slice(SERVER.indexOf("const LIMITE_MENSAGEM_MANUAL"), SERVER.indexOf("async function processarMensagem("));
  ok(/if \(!limpo\) return \{ ok: false, motivo: "Mensagem vazia\." \};/.test(bloco), "7. vazia não sai");
  ok(/LIMITE_MENSAGEM_MANUAL = 1500;/.test(bloco) && /limpo\.length > LIMITE_MENSAGEM_MANUAL/.test(bloco), "7b. tem teto de tamanho");
  ok(/if \(!sockAtivo\) return \{ ok: false, motivo: "WhatsApp desconectado\." \};/.test(bloco), "7c. sem WhatsApp, avisa em vez de fingir que mandou");
}

// ------------------------------------------------- 8. retomar continua existindo, e é o caminho de volta
{
  ok(/"\/api\/retomar-atendimento"/.test(PAINEL) && /btn-retomar-contato/.test(JS), "8. o botão de retomar o automático continua lá: é como a Carla volta a falar");
}

console.log(`\nmensagem-manual: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
