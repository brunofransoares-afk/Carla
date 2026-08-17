/*
 * Bateria do travessão.
 *
 * O prompt já mandava, desde sempre: "NUNCA use travessão (—) nas suas respostas".
 * E o próprio prompt estava escrito com 81 travessões. A Carla aprende muito mais pelo
 * jeito que o texto à volta é escrito do que por uma linha proibindo, então ela usava
 * travessão o tempo todo, obedecendo o exemplo em vez da regra.
 *
 * Não é firula: é o mesmo problema que apareceu a semana inteira, duas regras brigando
 * uma com a outra. E o travessão volta fácil, porque escrever com ele é natural pra quem
 * está editando o arquivo. Então a proibição fica aqui, verificada, e não na disciplina.
 *
 * O único travessão permitido em cerebro-ia.js é o que nomeia o caractere na própria
 * regra. Comentário de código não conta: aquilo é conversa entre quem mexe no arquivo,
 * a Carla nunca lê.
 *
 * Roda com:  node tests/sem-travessao.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }

const raiz = path.join(__dirname, "..");

// Só as linhas que a Carla enxerga: o prompt, as descrições das ferramentas e os motivos
// que voltam das ferramentas. Comentário de código fica de fora.
function linhasQueACarlaLe(arquivo) {
  return fs.readFileSync(path.join(raiz, arquivo), "utf8")
    .split("\n")
    .map((texto, i) => ({ n: i + 1, texto }))
    .filter(({ texto }) => !texto.trimStart().startsWith("//") && !texto.trimStart().startsWith("*"));
}

// ------------------------------------------------- 1. o prompt e as ferramentas
{
  const suspeitas = linhasQueACarlaLe("cerebro-ia.js").filter(({ texto }) => texto.includes("—"));
  const permitida = suspeitas.filter(({ texto }) => texto.includes("travessão (—)"));
  const sobrando = suspeitas.filter(({ texto }) => !texto.includes("travessão (—)"));

  ok(permitida.length === 1,
    `1. a regra que nomeia o caractere continua no prompt (achei ${permitida.length})`);
  ok(sobrando.length === 0,
    `1. nenhum outro travessão no que a Carla lê (linha(s): ${sobrando.map((l) => l.n).join(", ")})`);
}

// ------------------------------------------------- 2. o que sai direto pro WhatsApp
// Aqui não passa nem o travessão da regra: é texto que chega na família sem a IA no meio.
{
  for (const arquivo of ["avisos-texto.js", "oferta-de-horarios.js"]) {
    const sobrando = linhasQueACarlaLe(arquivo).filter(({ texto }) => texto.includes("—"));
    ok(sobrando.length === 0,
      `2. ${arquivo} sem travessão (linha(s): ${sobrando.map((l) => l.n).join(", ")})`);
  }

  // As respostas de emergência (IA fora do ar, erro na chamada) são escritas por nós e vão
  // inteiras pra família, sem a IA no meio pra obedecer regra nenhuma.
  const fonte = fs.readFileSync(path.join(raiz, "cerebro-ia.js"), "utf8");
  // O \s+ é obrigatório: sem ele o regex casa com o `resposta:"` de dentro de um
  // console.error e engole a string de verdade, e o teste passa sem ter olhado nada.
  const respostasFixas = fonte.match(/resposta:\s+"[^"]*"/g) || [];
  ok(respostasFixas.length >= 2, `2. achei as respostas fixas pra conferir (${respostasFixas.length})`);
  const comTravessao = respostasFixas.filter((r) => r.includes("—"));
  ok(comTravessao.length === 0,
    `2. as respostas fixas não usam travessão (${comTravessao.join(" | ")})`);
}

// ------------------------------------------------- 3. a regra continua escrita no prompt
{
  const fonte = fs.readFileSync(path.join(raiz, "cerebro-ia.js"), "utf8");
  ok(/NUNCA use travessão \(—\)/.test(fonte),
    "3. a instrução explícita continua lá — tirar o exemplo não substitui a regra");
}

console.log(erros.map((e) => "  FALHA " + e).join("\n"));
console.log(`sem-travessao: ${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
