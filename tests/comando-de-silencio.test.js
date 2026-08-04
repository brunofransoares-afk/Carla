/*
 * Bateria do comando de silêncio.
 *
 * Caso real, 10:48. Uma representante da Danone escreveu pedindo pra agendar uma visita
 * com o Dr. Bruno, e leu isto na tela:
 *
 *   Bom dia, Érica! 😊
 *
 *   Obrigada pelo contato! Vou repassar essa mensagem pro Dr. Bruno.
 *
 *   SILENCIO
 *
 * A trava era uma igualdade — só valia se a mensagem INTEIRA fosse a palavra — então
 * resposta de verdade com o comando emendado no fim passava batido e ia tudo pro WhatsApp.
 *
 * A regra vive em arquivo próprio, sem dependência, pra a bateria poder exercitar sem
 * carregar o SDK da Anthropic e a agenda inteira.
 *
 * Roda com:  node tests/comando-de-silencio.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { lerComandoDeSilencio } = require(path.join(__dirname, "..", "comando-de-silencio.js"));

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

// ------------------------------------------------- 1. o caso que aconteceu
{
  const daDanone = "Bom dia, Érica! 😊\n\nObrigada pelo contato! Vou repassar essa mensagem pro Dr. Bruno.\n\nSILENCIO";
  const r = lerComandoDeSilencio(daDanone);
  eq(r.texto, "Bom dia, Érica! 😊\n\nObrigada pelo contato! Vou repassar essa mensagem pro Dr. Bruno.",
    "1. a resposta de verdade sai inteira, sem o comando");
  eq(r.silencio, false, "1. e é pra mandar, porque sobrou texto");
  eq(r.vazou, true, "1. marcado como vazamento, pra quem chama registrar no log");
  ok(!r.texto.includes("SILENCIO"), "1. a palavra não chega na família de jeito nenhum");
}

// ------------------------------------------------- 2. o uso normal continua funcionando
{
  for (const entrada of ["SILENCIO", "  SILENCIO  ", "\nSILENCIO\n", "silencio", "Silencio"]) {
    const r = lerComandoDeSilencio(entrada);
    eq(r.silencio, true, `2. "${entrada.trim()}" sozinho continua sendo silêncio`);
    eq(r.vazou, false, `2. "${entrada.trim()}" sozinho é uso normal, não vazamento`);
  }
}

// ------------------------------------------------- 3. resposta normal não é tocada
{
  const normal = "Claro 😊\n\nTenho terça-feira (04/08) às 8h ou terça-feira (04/08) às 14h. Qual fica melhor?";
  const r = lerComandoDeSilencio(normal);
  eq(r.texto, normal, "3. resposta comum passa igualzinha");
  eq(r.silencio, false, "3. e é pra mandar");
  eq(r.vazou, false, "3. sem vazamento nenhum");
}

// ------------------------------------------------- 4. emendado no meio da frase
{
  const r = lerComandoDeSilencio("Vou repassar pro Dr. Bruno. SILENCIO");
  eq(r.texto, "Vou repassar pro Dr. Bruno.", "4. comando na mesma linha também é arrancado");
  eq(r.vazou, true, "4. e conta como vazamento");
}

// ------------------------------------------------- 5. só o comando, mas em duas linhas
{
  // Se o que sobrar for nada, é silêncio — mesmo tendo vindo com quebra de linha em volta.
  const r = lerComandoDeSilencio("\n\nSILENCIO\n\n");
  eq(r.silencio, true, "5. comando sozinho entre quebras de linha ainda é silêncio");
  eq(r.texto, "", "5. e não sobra texto nenhum pra mandar");
}

// ------------------------------------------------- 5b. comando no meio, com texto depois
{
  // Aqui os dois jeitos de arrancar se separam: tirar a linha inteira não deixa rastro,
  // trocar só a palavra por espaço deixaria uma linha de espaço solto no meio da mensagem.
  const r = lerComandoDeSilencio("Obrigada pelo contato!\n\nSILENCIO\n\nQualquer coisa é só chamar.");
  eq(r.texto, "Obrigada pelo contato!\n\nQualquer coisa é só chamar.",
    "5b. comando no meio some sem deixar linha em branco sobrando");
  eq(r.vazou, true, "5b. e conta como vazamento");
}

// ------------------------------------------------- 6. português normal não é mutilado
{
  // "silêncio" com acento e minúsculo é palavra do idioma, e a Carla pode escrever.
  const frase = "O consultório é bem tranquilo, tem um silêncio gostoso na sala de espera.";
  const r = lerComandoDeSilencio(frase);
  eq(r.texto, frase, "6. a palavra acentuada e minúscula é português, não comando");
  eq(r.vazou, false, "6. e não dispara alarme falso");

  const semAcento = "Ela pediu silencio na sala.";
  eq(lerComandoDeSilencio(semAcento).texto, semAcento, "6. minúscula sem acento também passa");
}

// ------------------------------------------------- 7. entrada torta não quebra
{
  eq(lerComandoDeSilencio("").silencio, true, "7. string vazia é silêncio");
  eq(lerComandoDeSilencio("   ").silencio, true, "7. só espaço é silêncio");
  eq(lerComandoDeSilencio(null).silencio, true, "7. null não quebra");
  eq(lerComandoDeSilencio(undefined).silencio, true, "7. undefined não quebra");
  eq(lerComandoDeSilencio(null).vazou, false, "7. e nada disso é vazamento");
}

// ------------------------------------------------- 8. o cérebro usa a regra, não a igualdade
// A igualdade antiga era o bug. Se ela voltar, o vazamento volta com ela.
{
  const fonte = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
  ok(!/toUpperCase\(\)\s*===\s*"SILENCIO"/.test(fonte),
    "8. a comparação por igualdade não está mais no cerebro-ia.js");
  ok(/ComandoDeSilencio\.lerComandoDeSilencio\(respostaTexto\)/.test(fonte),
    "8. o texto que sai passa pela regra antes de virar resposta");
  ok(/SILENCIO É COMANDO PRO SISTEMA/.test(fonte),
    "8. e o prompt diz por escrito que o comando nunca vem junto de texto");
}

console.log(erros.map((e) => "  FALHA " + e).join("\n"));
console.log(`comando-de-silencio: ${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
