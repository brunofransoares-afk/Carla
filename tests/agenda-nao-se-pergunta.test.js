/*
 * Bateria: a Carla não pergunta o que a agenda responde.
 *
 * Print de 10/09, 09:02. A família perguntou do acompanhamento, a Carla explicou bem e
 * fechou com "Você já tem uma consulta agendada, ou gostaria de marcar?". A agenda é dela.
 * O sistema já punha no prompt a consulta marcada daquele telefone; o que faltava era dizer
 * o CONTRÁRIO com a mesma força (não há consulta) e proibir a pergunta. E, como prompt não é
 * trava, existe a de máquina: a frase que pergunta é arrancada da resposta e substituída
 * pelo que a agenda diz.
 *
 * Roda com:  node tests/agenda-nao-se-pergunta.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const A = require(path.join(__dirname, "..", "agenda-nao-se-pergunta.js"));
const CEREBRO = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
const PROMPT = CEREBRO.slice(CEREBRO.indexOf("const PROMPT_ESTAVEL = `"), CEREBRO.indexOf("function montarSystemPrompt("));
const SEM_COMENTARIO = PROMPT.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

const DO_PRINT = "O Dr. Bruno tem um formato de acompanhamento que ele apresenta durante a própria consulta, com a programação te explicada nesse momento e enviada depois em um PDF.\n\nAlém disso, depois de qualquer consulta a família fica com o WhatsApp direto com ele por 30 dias, pra tirar dúvidas e receber orientações.\n\nVocê já tem uma consulta agendada, ou gostaria de marcar? 😊";

// ------------------------------------------------- 1. o caso do print
{
  const r = A.corrigirPerguntaDeAgenda(DO_PRINT, null);
  ok(r.corrigiu, "1. a pergunta do print é pega");
  ok(!/já tem uma consulta agendada/.test(r.texto), "1b. e sai da resposta");
  ok(/formato de acompanhamento/.test(r.texto) && /30 dias/.test(r.texto), "1c. o resto da resposta fica inteiro");
  ok(r.texto.endsWith("Se quiser marcar, me conta se prefere de manhã ou à tarde que eu vejo um horário."), "1d. sem consulta marcada, o fecho é o convite certo (período, como manda a regra do valor)");
  ok(!/😊\s*$/.test(r.texto.split("\n\n").slice(0, -1).join("")), "1e. o emoji da frase arrancada foi junto com ela");

  const com = A.corrigirPerguntaDeAgenda(DO_PRINT, { crianca: "Miguel", diaLabel: "quinta 12/09 às 09:00" });
  ok(com.corrigiu && /A consulta de Miguel já está marcada pra quinta 12\/09 às 09:00\.$/.test(com.texto), "1f. com consulta marcada, o fecho diz qual é, em vez de perguntar");
}

// ------------------------------------------------- 2. variações e o que NÃO é pergunta
{
  for (const frase of [
    "Você já tem consulta marcada com o Dr. Bruno?",
    "Já marcou a consulta?",
    "Vocês já têm horário agendado?",
    "Tem alguma consulta agendada aqui?",
    "Já está com consulta marcada, ou quer que eu veja um horário?",
  ]) ok(A.ehPerguntaDeAgenda(frase), `2. pega: "${frase}"`);

  for (const frase of [
    "A consulta do Miguel já está marcada pra quinta às 9h.",
    "Quer marcar uma consulta?",
    "Você prefere de manhã ou à tarde?",
    "Já tem um horário reservado pra vocês: quinta às 9h.",
    "Você já tem consulta marcada com o Dr. Bruno, então é só chegar 10 minutos antes.",
    "Qual consulta você está procurando: urgência, rotina ou neurodesenvolvimento?",
  ]) ok(!A.ehPerguntaDeAgenda(frase), `2b. deixa passar: "${frase}"`);

  const nada = A.corrigirPerguntaDeAgenda("Você prefere de manhã ou à tarde?", null);
  ok(!nada.corrigiu && nada.texto === "Você prefere de manhã ou à tarde?", "2c. resposta sem a pergunta passa intacta");
  eq(A.corrigirPerguntaDeAgenda("", null).corrigiu, false, "2d. vazio não quebra");
  const so = A.corrigirPerguntaDeAgenda("Já tem consulta marcada?", null);
  ok(so.corrigiu && so.texto === "Se quiser marcar, me conta se prefere de manhã ou à tarde que eu vejo um horário.", "2e. quando a resposta é só a pergunta, sobra só o fecho");
}

// ------------------------------------------------- 3. o prompt diz o contrário com a mesma força
{
  ok(/NÃO HÁ CONSULTA MARCADA NESTE TELEFONE\./.test(PROMPT), "3. quando não tem consulta, o contexto diz isso");
  ok(/CONSULTA JÁ MARCADA NESTE TELEFONE\./.test(PROMPT), "3b. e quando tem, continua dizendo qual");
  ok(/NUNCA pergunte "você já tem uma consulta agendada\?"/.test(PROMPT), "3c. com a proibição escrita na cara");
  ok(/a agenda é sua, quem responde isso é você/.test(PROMPT), "3d. e o motivo");
  ok(/perguntar se a família já tem consulta marcada \(a agenda é sua/.test(SEM_COMENTARIO), "3e. também na lista NUNCA do bloco estável");
  // Os dois galhos vivem no mesmo ternário: se alguém apagar o else, o sem-consulta volta a ficar mudo.
  const i = PROMPT.indexOf("${consultaProxima ? `");
  const j = PROMPT.indexOf("NÃO HÁ CONSULTA MARCADA NESTE TELEFONE");
  ok(i > 0 && j > i && /` : `\s*\nNÃO HÁ CONSULTA/.test(PROMPT), "3f. o 'não há' é o else do 'já marcada', não um bloco solto");
}

// ------------------------------------------------- 4. a trava está ligada na saída
{
  ok(/const AgendaNaoSePergunta = require\(path\.join\(__dirname, "agenda-nao-se-pergunta\.js"\)\);/.test(CEREBRO), "4. o cérebro carrega a trava");
  ok(/AgendaNaoSePergunta\.corrigirPerguntaDeAgenda\(respostaTexto, consultaProxima\)/.test(CEREBRO), "4b. e aplica na resposta, com a consulta do telefone");
  ok(/if \(perguntaDeAgenda\.corrigiu\) \{[\s\S]{0,400}respostaTexto = perguntaDeAgenda\.texto;/.test(CEREBRO), "4c. trocando o texto que sai");
  ok(/\[SEGURANÇA\] A IA perguntou se a família já tem consulta marcada/.test(CEREBRO), "4d. e deixando registro, pra ver no log quantas vezes o prompt não segurou");
  const posTrava = CEREBRO.indexOf("AgendaNaoSePergunta.corrigirPerguntaDeAgenda(");
  const posSilencio = CEREBRO.indexOf("ComandoDeSilencio.lerComandoDeSilencio(respostaTexto)");
  ok(posTrava > 0 && posSilencio > posTrava, "4e. antes do comando de silêncio, que é a última coisa que mexe no texto");
}

// ------------------------------------------------- 5. operação na consulta que já existe PASSA
{
  // Auditoria de 10/09, problema 8: a trava trocava "Posso cancelar a consulta marcada?" por
  // "A consulta de X já está marcada pra sexta às 14h.". A pergunta que CONCLUI o cancelamento
  // desaparecia, e o fluxo de dois turnos (preparar, confirmar, cancelar) ficava sem o turno
  // do meio. Perguntar se a consulta existe é o defeito; perguntar o que fazer com ela não é.
  const consulta = { crianca: "Miguel", diaLabel: "sexta (12/09) às 14:00" };
  const intacta = (texto, motivo) => {
    const r = A.corrigirPerguntaDeAgenda(texto, consulta);
    ok(r.corrigiu === false && r.texto === texto, motivo);
  };
  intacta("Posso cancelar a consulta marcada?", "5. a pergunta do cancelamento sobrevive inteira");
  intacta("Confirma que quer cancelar a consulta de Miguel em sexta (12/09) às 14:00?", "5b. e a frase exata que o prompt manda escrever no cancelamento (essa nem chega a parecer pergunta de agenda, mas fica fixada)");
  intacta("Quer remarcar a consulta marcada, ou fica assim?", "5c. remarcar também");
  intacta("Posso desmarcar a consulta agendada?", "5d. desmarcar também");
  intacta("Posso transferir a consulta agendada?", "5e. transferir também");
  intacta("Prefere manter a consulta marcada, ou vemos outro dia?", "5e2. manter também");
  intacta("Quer adiar a consulta agendada?", "5f. adiar também");

  // E a trava continua pegando o que ela existe pra pegar.
  for (const frase of [
    "Você já tem uma consulta agendada, ou gostaria de marcar?",
    "Você já tem consulta marcada comigo?",
    "Já possui horário agendado?",
  ]) {
    const r = A.corrigirPerguntaDeAgenda(frase, consulta);
    ok(r.corrigiu === true && /já está marcada pra sexta \(12\/09\) às 14:00/.test(r.texto), `5g. "${frase}" continua sendo trocada pela resposta da agenda`);
  }

  // A veto é por FRASE: uma pergunta indevida no mesmo texto de uma frase sobre cancelamento
  // continua caindo, senão bastaria a IA citar "cancelar" em qualquer lugar pra escapar.
  const misto = A.corrigirPerguntaDeAgenda("Você já tem consulta marcada?\n\nSe quiser, posso cancelar a consulta marcada de sexta.", consulta);
  ok(misto.corrigiu === true, "5h. a veto vale frase a frase: a pergunta indevida ao lado de uma frase de cancelamento continua caindo");
  ok(/posso cancelar a consulta marcada de sexta/.test(misto.texto), "5i. e a frase legítima do mesmo texto fica");
  ok(!/Você já tem consulta marcada\?/.test(misto.texto), "5j. enquanto a indevida sai");

  ok(/OPERACAO_NA_CONSULTA\.test\(frase\)\) return false;/.test(fs.readFileSync(path.join(__dirname, "..", "agenda-nao-se-pergunta.js"), "utf8")), "5k. a veto roda ANTES do teste da pergunta, não depois");
}

console.log(`\nagenda-nao-se-pergunta: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
