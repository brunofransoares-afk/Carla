// Compara a lista de palavras de emergência que está no ar hoje com a lista proposta,
// usando frases do jeito que uma mãe escreve no WhatsApp às onze da noite.
//
// Duas coisas importam aqui, e a segunda é tão importante quanto a primeira:
//   1. nenhuma emergência de verdade pode passar batido
//   2. nenhuma consulta comum pode virar alarme falso
//
// Alarme falso não é inofensivo: a Carla para de atender, escala pra equipe e a família
// fica esperando um retorno humano por causa de um joelho ralado.
//
//   node carla-lab/emergencia/testar.js

const fs = require("fs");
const path = require("path");

const DIACRITICOS = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g");

// Mesma normalização do cerebro-ia.js: minúsculas, sem acento, aparada.
function normalizar(t) {
  return t.toLowerCase().normalize("NFD").replace(DIACRITICOS, "").trim();
}

function dispara(texto, palavras) {
  const n = normalizar(texto);
  return palavras.find((p) => n.includes(p)) || null;
}

// A lista que está rodando hoje, lida do config.js versionado.
const atual = (() => {
  const fonte = fs.readFileSync(path.join(__dirname, "..", "vps", "arquivos", "config.js"), "utf8");
  const i = fonte.indexOf("const EMERGENCIA_PALAVRAS = [");
  const j = fonte.indexOf("];", i);
  return JSON.parse("[" + fonte.slice(i + 28, j + 1).replace(/,\s*\]$/, "]").slice(1));
})();

const proposta = require("./palavras-propostas.js");

const casos = JSON.parse(fs.readFileSync(path.join(__dirname, "frases-reais.json"), "utf8"));

function avaliar(palavras) {
  const escaparam = [];
  const falsosAlarmes = [];
  const aceitos = [];
  for (const caso of casos) {
    const bateu = dispara(caso.frase, palavras);
    if (caso.emergencia && !bateu) escaparam.push(caso);
    if (!caso.emergencia && bateu) {
      // Trocas declaradas no corpus: alarme falso conhecido, aceito de propósito,
      // porque o custo de deixar o sinal de verdade passar é maior. Aparece no
      // relatório separado, nunca escondido.
      (caso.alarmeFalsoAceito ? aceitos : falsosAlarmes).push({ ...caso, bateu });
    }
  }
  return { escaparam, falsosAlarmes, aceitos };
}

const a = avaliar(atual);
const p = avaliar(proposta);

const emergencias = casos.filter((c) => c.emergencia).length;
const comuns = casos.length - emergencias;

console.log(`\n${casos.length} frases: ${emergencias} emergências de verdade, ${comuns} conversas comuns\n`);
console.log(`                        HOJE      PROPOSTA`);
console.log(`emergência que escapa   ${String(a.escaparam.length).padStart(4)}      ${String(p.escaparam.length).padStart(4)}`);
console.log(`alarme falso            ${String(a.falsosAlarmes.length).padStart(4)}      ${String(p.falsosAlarmes.length).padStart(4)}`);

if (a.escaparam.length) {
  console.log(`\nEmergências que HOJE passam batido:`);
  for (const c of a.escaparam) console.log(`  "${c.frase}"`);
}

if (p.escaparam.length) {
  console.log(`\nAINDA passam batido com a lista proposta:`);
  for (const c of p.escaparam) console.log(`  "${c.frase}"`);
}

if (p.aceitos.length) {
  console.log(`\nTrocas assumidas (alarme falso aceito de propósito):`);
  for (const c of p.aceitos) console.log(`  "${c.frase}"  -> "${c.bateu}"  ${c.nota}`);
}

if (p.falsosAlarmes.length) {
  console.log(`\nALARMES FALSOS da lista proposta (conversa comum virando emergência):`);
  for (const c of p.falsosAlarmes) console.log(`  "${c.frase}"  -> disparou por "${c.bateu}"`);
}

console.log(`\npalavras: ${atual.length} hoje, ${proposta.length} na proposta (+${proposta.length - atual.length})`);

const regrediu = p.escaparam.length > a.escaparam.length || p.falsosAlarmes.length > a.falsosAlarmes.length;
if (regrediu || p.escaparam.length > 0 || p.falsosAlarmes.length > 0) {
  console.log(`\nA proposta ainda não está pronta.`);
  process.exit(1);
}
console.log(`\nProposta aprovada: nenhuma emergência escapa e nenhum alarme falso.`);
