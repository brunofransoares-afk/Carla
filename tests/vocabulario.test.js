/*
 * Bateria do vocabulário da Carla.
 *
 * Caso real, 19:36. O Dr. Bruno respondeu só "Quinta" e recebeu:
 *
 *   "Show ótimo! 😊
 *
 *    Antes de eu separar, só um adianta: as consultas têm duração média de 1 hora..."
 *
 * Três erros numa abertura de seis palavras: gíria ("show"), duas palavras de aprovação
 * empilhadas ("show ótimo"), e uma frase quebrada ("só um adianta").
 *
 * A frase quebrada não é acaso. O prompt já proibia "enquanto isso já te adianto", mas só
 * DENTRO da regra de perguntar o motivo da consulta — então ela reusou a mesma construção
 * noutro ponto da conversa, onde nada a proibia. É o padrão da semana inteira: regra
 * escrita estreita demais, e o comportamento reaparece do lado de fora dela.
 *
 * Esta bateria guarda duas coisas: que as regras continuam escritas, e que o próprio prompt
 * não ensina pelo exemplo aquilo que proíbe — foi assim que o travessão sobreviveu a uma
 * proibição explícita por meses.
 *
 * Roda com:  node tests/vocabulario.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }

const fonte = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");

// Só o que a Carla lê: comentário de código é conversa entre quem mexe no arquivo.
const queElaLe = fonte
  .split("\n")
  .map((texto, i) => ({ n: i + 1, texto }))
  .filter(({ texto }) => !texto.trimStart().startsWith("//") && !texto.trimStart().startsWith("*"));

// ------------------------------------------------- 1. as regras existem
{
  ok(/COMO VOCÊ FALA:/.test(fonte), "1. a regra de registro está escrita");
  ok(/VOCÊ NUNCA "ADIANTA" NADA:/.test(fonte), "1. e a que proíbe emendar assunto pedindo licença");
  ok(/NUNCA empilhe duas palavras de aprovação/.test(fonte),
    "1. inclusive a que proíbe \"Show ótimo\"");
}

// ------------------------------------------------- 2. a proibição não é mais local
// A versão antiga vivia só dentro da regra do motivo da consulta, e por isso não pegou.
{
  const dentroDaRegraGeral = fonte.indexOf('VOCÊ NUNCA "ADIANTA" NADA');
  const dentroDaRegraDoMotivo = fonte.indexOf("QUEM PEDE PRA AGENDAR SEM DIZER O MOTIVO");
  ok(dentroDaRegraGeral >= 0 && dentroDaRegraGeral < dentroDaRegraDoMotivo,
    "2. a regra geral vem ANTES da específica, então vale pra conversa inteira");
}

// ------------------------------------------------- 3. o prompt não ensina pelo exemplo
// O travessão sobreviveu meses a uma proibição explícita porque o prompt inteiro era
// escrito com ele. Aqui a conta é a mesma: cada uso solto vale mais que a regra.
{
  // As linhas que PROÍBEM precisam citar as expressões, então são justamente as que
  // contêm as palavras. O que não pode é aparecer fora delas.
  const proibicoes = /COMO VOCÊ FALA:|VOCÊ NUNCA "ADIANTA" NADA:|já te adianto|Nunca "antes de eu separar/;
  const escorregoes = queElaLe.filter(({ texto }) =>
    /\b(adianto|adiantando|adianta)\b/i.test(texto) && !proibicoes.test(texto));
  ok(escorregoes.length === 0,
    `3. "adiantar" só aparece nas regras que o proíbem (linha(s): ${escorregoes.map((l) => l.n).join(", ")})`);

  const girias = queElaLe.filter(({ texto }) =>
    /\b(show|top|massa|bacana)\b/i.test(texto) && !/COMO VOCÊ FALA:/.test(texto));
  ok(girias.length === 0,
    `3. nenhuma gíria solta no que ela lê (linha(s): ${girias.map((l) => l.n).join(", ")})`);
}

// ------------------------------------------------- 4. a mensagem do valor tem abertura pronta
// Sem um exemplo de como começar, ela inventa — e foi inventando que saiu "Antes de eu
// separar, só um adianta".
{
  ok(/"Quinta, então 😊"/.test(fonte),
    "4. a regra do valor antes de reservar mostra como abrir a mensagem");
}

console.log(erros.map((e) => "  FALHA " + e).join("\n"));
console.log(`vocabulario: ${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
