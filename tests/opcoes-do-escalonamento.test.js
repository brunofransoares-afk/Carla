/*
 * Bateria: todo escalonamento chega com três botões que servem pra ele.
 *
 * O dono, em 01/10/2026: "para todos os outros motivos no qual eu sou escalonado, eu gostaria
 * também que você fizesse uma revisão nas opções, deixasse sempre três opções pertinentes
 * referente àquele escalonamento, ao motivo daquele escalonamento."
 *
 * A CARLA PODIA MANDAR AS OPÇÕES, E O RESULTADO ERA IRREGULAR: às vezes três, às vezes duas,
 * às vezes nenhuma, às vezes um rótulo comprido demais pra caber no botão. Ela passou a
 * escolher só o MOTIVO, de uma lista fechada e curta, e o motivo decide os botões. Lista
 * fechada o modelo acerta; redação de botão, não.
 *
 * O QUE ESTA BATERIA GUARDA, e é mais do que "existem três":
 *
 *   - O VALOR do botão é o que volta pra Carla, então ele é escrito como INSTRUÇÃO. Era aí
 *     que a conversa morria: ele clicava "não", e ela não sabia se oferecia outra coisa ou
 *     encerrava. Todo "não" aqui diz o que fazer em seguida.
 *   - "sim" é palavra reservada: é ela que faz o painel abrir o horário pedido na agenda.
 *     Trocar esse valor por um texto bonito desligaria a abertura sem erro nenhum aparecer.
 *   - Alerta SEM pergunta não ganha botão. É o caso em que ele precisa ler e responder com as
 *     palavras dele, e três botões ali empurrariam uma resposta pronta pra uma situação que
 *     não cabe em nenhuma.
 *
 * Roda com:  node tests/opcoes-do-escalonamento.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const O = require("../opcoes-do-escalonamento.js");

let passou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const COM_BOTOES = ["horario", "tipo", "valor", "fim_de_semana", "outro"];
const CAMINHO_PROPRIO = ["pagamento", "encaixe"];

// ------------------------------------------------- 1. três, sempre três
{
  for (const motivo of COM_BOTOES) {
    const b = O.opcoesDoEscalonamento(motivo);
    eq(b.length, 3, "1. " + motivo + ": três opções");
    eq(new Set(b.map((o) => o.valor)).size, 3, "1b. " + motivo + ": três respostas diferentes");
    eq(new Set(b.map((o) => o.rotulo)).size, 3, "1c. " + motivo + ": três rótulos diferentes");
    ok(b.every((o) => o.rotulo.length > 0 && o.rotulo.length <= 30),
      "1d. " + motivo + ": rótulos curtos (o botão é lido no celular)");
    ok(b.every((o) => o.valor.length > 0 && o.valor.length <= 200),
      "1e. " + motivo + ": valores cabem no campo do alerta");
  }
  eq(O.MOTIVOS.length, COM_BOTOES.length, "1f. e não existe motivo com botões fora da lista");
}

// ------------------------------------------------- 2. o "não" nunca é só "não"
{
  // O valor é o que a Carla lê como resposta do Dr. Bruno. Um "não" seco deixa ela sem saber
  // o que fazer em seguida, e é assim que a conversa morre depois de ele responder.
  for (const motivo of ["horario", "fim_de_semana"]) {
    const recusas = O.opcoesDoEscalonamento(motivo).slice(1);
    ok(recusas.every((o) => /ofereça os horários/i.test(o.valor)),
      "2. " + motivo + ": toda recusa já diz o que fazer em seguida");
  }
  const valor = O.opcoesDoEscalonamento("valor");
  ok(/sem constranger/.test(valor[0].valor), "2b. manter o valor vem com o tom junto");
  ok(/3x sem juros/.test(valor[1].valor), "2c. e o parcelamento diz o que pode ser oferecido");
  ok(/não ofereça mais nada/.test(valor[2].valor),
    "2d. e 'eu falo com ela' manda a Carla parar, senão ela continua por cima dele");
  ok(/pergunte à família os detalhes que faltam/.test(O.opcoesDoEscalonamento("outro")[2].valor),
    "2e. o terceiro do 'outro' é o caso real de ele não conseguir decidir com o que está escrito");
}

// ------------------------------------------------- 3. "sim" é palavra reservada
{
  eq(O.opcoesDoEscalonamento("horario")[0].valor, "sim",
    "3. horário: o 'consigo' vale 'sim', que é o que abre o horário na agenda");
  eq(O.opcoesDoEscalonamento("fim_de_semana")[0].valor, "sim", "3b. e no fim de semana também");
  const PAINEL = fs.readFileSync(path.join(__dirname, "..", "painel-server.js"), "utf8");
  ok(/const ehSim = resposta\.toLowerCase\(\) === "sim";/.test(PAINEL),
    "3c. e o painel continua reconhecendo essa palavra: é o par que não pode ser desfeito de um lado só");
  ok(/if \(ehSim && alerta\.dataPedida && alerta\.horaPedida\)/.test(PAINEL),
    "3d. com a data e a hora que a Carla mandou");
}

// ------------------------------------------------- 4. os tipos continuam falando com a ferramenta
{
  eq(JSON.stringify(O.opcoesDoEscalonamento("tipo").map((o) => o.valor)),
    JSON.stringify(["urgencia", "puericultura", "tnd"]),
    "4. os três tipos voltam com as chaves que confirmar_agendamento entende");
  const CEREBRO = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
  ok(/enum: \["urgencia", "puericultura", "tnd"\]/.test(CEREBRO),
    "4b. e são as mesmas chaves do enum da reserva: um 'não' silencioso aqui marcaria o tipo errado");
}

// ------------------------------------------------- 5. quem tem caminho próprio não passa aqui
{
  for (const motivo of CAMINHO_PROPRIO) {
    eq(O.opcoesDoEscalonamento(motivo), null, "5. " + motivo + ": caminho próprio, não é aqui");
  }
  eq(O.opcoesDoEscalonamento("outro", { temPergunta: false }), null,
    "5b. sem pergunta não tem botão, qualquer que seja o motivo");
  eq(O.opcoesDoEscalonamento("horario", { temPergunta: false }), null, "5b2. inclusive os que têm");
}

// ------------------------------------------------- 6. motivo torto não vira poder
{
  for (const lixo of ["inventado", "", null, undefined, 42, "PAGAMENTO", { a: 1 }]) {
    eq(O.normalizarMotivo(lixo), "outro", "6. " + JSON.stringify(lixo) + " vira 'outro'");
  }
  eq(O.opcoesDoEscalonamento("inventado").length, 3, "6b. e ainda assim ganha os três genéricos");
  // "PAGAMENTO" em maiúscula virando "outro" é de propósito: um assunto que não bate exato
  // não pode cair no caminho que MARCA RESERVA COMO PAGA.
  ok(O.normalizarMotivo("PAGAMENTO") !== "pagamento",
    "6c. e maiúscula não entra no caminho do pagamento, que mexe em dinheiro");
}

// ------------------------------------------------- 7. a ferramenta e a lista andam juntas
{
  const CEREBRO = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
  const enumDaFerramenta = (CEREBRO.match(/assunto: \{ type: "string", enum: \[([^\]]+)\]/) || [])[1] || "";
  const nomes = enumDaFerramenta.split(",").map((t) => t.trim().replace(/"/g, ""));
  eq(JSON.stringify(nomes), JSON.stringify(O.MOTIVOS_DA_FERRAMENTA),
    "7. o enum da ferramenta é exatamente a lista de motivos: um a mais aqui seria motivo sem botão");
  ok(!/opcoes: \{ type: \["array", "null"\]/.test(CEREBRO),
    "7b. e o campo opcoes saiu da ferramenta: botão não é coisa que o modelo escreve");
}

console.log(`opcoes-do-escalonamento: ${passou} passaram, ${erros.length} falharam`);
if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
