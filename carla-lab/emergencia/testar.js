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

// "antes" = a lista que rodou em produção até 29/07/2026, guardada como registro.
// "agora" = a lista que está no ar, lida do config.js versionado (espelho da produção).
const anterior = require("./palavras-anteriores.js");
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

const a = avaliar(anterior);
const p = avaliar(proposta);

const emergencias = casos.filter((c) => c.emergencia).length;
const comuns = casos.length - emergencias;

console.log(`\n${casos.length} frases: ${emergencias} emergências de verdade, ${comuns} conversas comuns\n`);
console.log(`                        ANTES     AGORA`);
console.log(`emergência que escapa   ${String(a.escaparam.length).padStart(4)}      ${String(p.escaparam.length).padStart(4)}`);
console.log(`alarme falso            ${String(a.falsosAlarmes.length).padStart(4)}      ${String(p.falsosAlarmes.length).padStart(4)}`);

if (a.escaparam.length) {
  console.log(`\nEmergências que passavam batido ANTES da correção:`);
  for (const c of a.escaparam) console.log(`  "${c.frase}"`);
}

if (p.escaparam.length) {
  console.log(`\nAINDA passam batido:`);
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

console.log(`\npalavras: ${anterior.length} antes, ${proposta.length} agora (+${proposta.length - anterior.length})`);

const regrediu = p.escaparam.length > a.escaparam.length || p.falsosAlarmes.length > a.falsosAlarmes.length;
if (regrediu || p.escaparam.length > 0 || p.falsosAlarmes.length > 0) {
  console.log(`\nA lista em produção não está íntegra.`);
  process.exit(1);
}
console.log(`\nLista em produção íntegra: nenhuma emergência escapa e nenhum alarme falso.`);
