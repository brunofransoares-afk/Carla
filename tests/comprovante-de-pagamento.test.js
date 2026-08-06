/*
 * Bateria do comprovante de pagamento.
 *
 * Quem confirma pagamento é o Dr. Bruno, no botão "Pago" do painel. Aquele botão dispara uma
 * mensagem escrita em código que confirma a consulta E pede o e-mail e a data de nascimento
 * que ainda faltam.
 *
 * O defeito: quando a família mandava o link do comprovante, a Carla respondia por conta
 * própria "recebi, vou repassar pro Dr. Bruno" e JÁ PEDIA e-mail e data de nascimento. Aí o
 * Dr. Bruno apertava o botão e a mesma família recebia o mesmo pedido de novo. Aconteceu com
 * o Almir em 06/08/2026 às 12:05, e o caso está no teste 1 abaixo, com o link verdadeiro.
 *
 * Por isso a decisão é CÓDIGO e não regra de prompt: regra de prompt ela contorna quando
 * outra regra puxa pro outro lado, e a semana inteira foi isso. Aqui a mensagem nem chega
 * na IA.
 *
 * O QUE ESTA BATERIA GUARDA COM MAIS CUIDADO é o outro lado: silêncio demais é pior que
 * silêncio de menos. Se isto começar a casar com conversa normal, a família fala e a Carla
 * não responde, e ninguém descobre, porque não tem erro nem log de resposta. Por isso a
 * seção 2 é a maior de todas.
 *
 * Roda com:  node tests/comprovante-de-pagamento.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const Comprovante = require(path.join(__dirname, "..", "comprovante-de-pagamento.js"));

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

// ------------------------------------------------- 1. o caso real
{
  // O link que o Almir mandou às 12:04 de 06/08/2026, e a resposta que a Carla NÃO pode
  // mais dar. É o link que o pagamento por cartão do consultório gera.
  const oCasoReal = "https://recibo.infinitepay.io/4ef4e242-19dd-437f-8697-d7a654f81cff";
  ok(Comprovante.pareceComprovante(oCasoReal), "1. o link do comprovante do Almir tem que calar a Carla");
  ok(Comprovante.pareceComprovante("Segue o comprovante " + oCasoReal), "1b. com texto junto também");
  ok(Comprovante.pareceComprovante(oCasoReal + "\n\nJá paguei!"), "1c. com texto depois também");
  ok(Comprovante.HOSTS_CONHECIDOS.includes("recibo.infinitepay.io"), "1d. o host da InfinitePay está na lista");
}

// ------------------------------------------------- 2. conversa normal NUNCA cala
{
  // Esta é a seção que mais importa. Cada uma destas é uma família falando de verdade, e
  // todas TÊM que continuar recebendo resposta.
  const conversas = [
    "Bom dia! Vocês atendem pelo plano do Frei Galvão?",
    "Acabei de pagar, viu?",
    "Fiz o Pix agora",
    "Paguei no cartão",
    "Já mandei o comprovante pro Dr. Bruno",
    "Vou pagar hoje à tarde, pode ser?",
    "Onde eu mando o comprovante?",
    "Você recebeu o comprovante?",
    "Qual o recibo que eu preciso guardar pro reembolso?",
    "Me manda o link de pagamento por favor",
    "https://link.infinitepay.io/brunoffsoares/VC1DLTMtSQ-n2bxJy5HPf-550,00",
    "Meu filho está com febre desde ontem",
    "Quero agendar uma consulta",
    "Olha esse artigo: https://www.sbp.com.br/departamentos/pediatria",
    "Achei vocês por aqui https://www.google.com/maps/place/limeira",
    "",
    "   ",
  ];
  for (const c of conversas) eq(Comprovante.pareceComprovante(c), false, "2. NÃO pode calar: " + JSON.stringify(c.slice(0, 55)));

  eq(Comprovante.pareceComprovante(null), false, "2b. texto nulo não quebra e não cala");
  eq(Comprovante.pareceComprovante(undefined), false, "2c. texto indefinido não quebra e não cala");
}

// ------------------------------------------------- 3. o link de pagamento não é comprovante
{
  // Os dois são infinitepay, e é fácil confundir num regex preguiçoso. O de PAGAR a Carla
  // manda (e responde em volta dele normalmente); só o de RECIBO cala.
  const pagar = "https://link.infinitepay.io/brunoffsoares/VC1DLTMtSQ-n2bxJy5HPf-550,00";
  const recibo = "https://recibo.infinitepay.io/4ef4e242-19dd-437f-8697-d7a654f81cff";
  eq(Comprovante.pareceComprovante(pagar), false, "3. o link de PAGAR não é comprovante");
  eq(Comprovante.pareceComprovante(recibo), true, "3b. o link de RECIBO é");
  ok(Comprovante.pareceComprovante(pagar + " " + recibo), "3c. os dois juntos: o recibo manda, cala");
}

// ------------------------------------------------- 4. outros bancos e carteiras
{
  // Não dá pra listar todo banco do Brasil, então o endereço que se anuncia como recibo
  // também conta. Comprovante de Pix quase sempre vem como IMAGEM, e imagem já passa em
  // silêncio hoje, mas quem manda link tem que ser coberto igual.
  const outros = [
    "https://comprovante.bb.com.br/abc123",
    "https://recibos.exemplo.com.br/xyz",
    "https://banco.exemplo.com/comprovante/98765",
    "https://app.exemplo.com/recibo?id=44",
    "http://comprovantes.exemplo.com/1",
  ];
  for (const u of outros) ok(Comprovante.pareceComprovante(u), "4. endereço de recibo cala: " + u);

  // E o que só MENCIONA a palavra no meio do caminho, sem ser um segmento, não conta.
  eq(Comprovante.pareceComprovante("https://exemplo.com/meucomprovantefalso"), false,
    "4b. palavra grudada no meio do caminho não conta");
}

// ------------------------------------------------- 5. o silêncio fica no lugar certo
{
  // Emergência é inegociável e vem ANTES. Alguém que mande o comprovante junto de "meu filho
  // está convulsionando" precisa da resposta de emergência, não do silêncio.
  const posEmergencia = SERVER.indexOf("pareceEmergencia(texto)");
  const posComprovante = SERVER.indexOf("Comprovante.pareceComprovante(texto)");
  ok(posEmergencia > 0, "5. a checagem de emergência existe");
  ok(posComprovante > 0, "5b. a checagem de comprovante existe");
  ok(posEmergencia < posComprovante, "5c. emergência tem que ser checada ANTES do comprovante");

  // Não pode responder nem chamar a IA: o trecho entre a checagem e o return não pode ter
  // envio nem chamada do cérebro.
  const trecho = SERVER.slice(posComprovante, posComprovante + 700);
  const ateOReturn = trecho.slice(0, trecho.indexOf("return;") + 7);
  ok(!/enviarResposta|sendMessage/.test(ateOReturn), "5d. não envia nada ao reconhecer comprovante");
  ok(!/CerebroIA\.responder/.test(ateOReturn), "5e. não chama a IA ao reconhecer comprovante");
  ok(/return;/.test(ateOReturn), "5f. sai da função sem seguir adiante");
  ok(!/sessao\.historico/.test(ateOReturn), "5g. não entra no histórico: senão a Carla teria material pra comentar o pagamento depois");
  ok(/ultimaMensagem/.test(ateOReturn), "5h. atualiza ultimaMensagem, pra o Dr. Bruno ver no painel que o comprovante chegou");
}

// ------------------------------------------------- 6. a mensagem do painel continua intacta
{
  // O Dr. Bruno pediu explicitamente que a mensagem do botão "Pago" ficasse igualzinha.
  // Ela é o único lugar que pede e-mail e data de nascimento agora.
  ok(SERVER.includes("Pagamento recebido! 😊"), "6. a abertura da mensagem do painel não mudou");
  ok(SERVER.includes("está confirmada para "), "6b. a confirmação da consulta continua lá");
  ok(/if \(!a\.responsavelEmail\) falta\.push\("seu \*e-mail\*"\);/.test(SERVER), "6c. o pedido de e-mail continua lá");
  ok(/if \(!a\.criancaDataNascimento\) falta\.push/.test(SERVER), "6d. o pedido de data de nascimento continua lá");
  ok(/if \(a\.pagamentoAvisadoEm\) return \{ ok: true, jaAvisado: true \};/.test(SERVER), "6e. a trava de clique repetido continua lá");
}

console.log(`\ncomprovante-de-pagamento: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
