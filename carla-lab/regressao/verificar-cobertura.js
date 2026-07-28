// Portão de integridade da suíte de regressão. Roda em qualquer lugar, sem chave de API
// e sem o carla-app: só lê o corpus e a personalidade.
//
// Confere três coisas:
//   1. o corpus está bem formado (ids únicos, turnos válidos, asserções conhecidas)
//   2. todo caso aponta pra comportamentos que existem de verdade
//   3. todo comportamento tem pelo menos um caso cobrindo
//
// A terceira é a que mantém a suíte viva: quando alguém criar uma regra nova sem escrever
// caso, isto quebra. Sem esse portão, a suíte vira decoração em poucos meses.
//
//   node carla-lab/regressao/verificar-cobertura.js

const fs = require("fs");
const path = require("path");
const { lerPersonalidade } = require("../nucleo/compositor.js");

const DIR_CASOS = path.join(__dirname, "casos");

const ASSERCOES_CONHECIDAS = new Set([
  "deveConter",
  "deveConterAlgum",
  "naoDeveConter",
  "naoDeveConterAmbos",
  "naoDeveConterExatamente",
  "naoDeveComecarCom",
  "respostaExata",
  "maxCaracteres",
  "maxHorariosOferecidos",
  "deveChamar",
  "naoDeveChamar",
  "deveChamarComArgumento",
  "contarNoMaximo",
  "deveTerPergunta",
  "deveTerPerguntaOuFerramenta",
  "naoDeveTerApenas",
  "naoDeveRepetirHorariosDoTurnoAnterior",
  "seChamouFerramentaDeveConter",
  "seNaoChamouFerramentaNaoDeveConter",
  "deveSerTratadoComoEmergencia",
  "naoDeveChamarIA",
  "naoDeveContinuarAssunto",
]);

function carregarCasos() {
  const arquivos = fs.readdirSync(DIR_CASOS).filter((f) => f.endsWith(".json")).sort();
  const casos = [];
  for (const arquivo of arquivos) {
    const conteudo = JSON.parse(fs.readFileSync(path.join(DIR_CASOS, arquivo), "utf8"));
    if (!Array.isArray(conteudo)) throw new Error(`${arquivo} deveria conter uma lista de casos`);
    for (const caso of conteudo) casos.push({ ...caso, arquivo });
  }
  return casos;
}

function main() {
  const personalidade = lerPersonalidade("v1");
  const casos = carregarCasos();
  const problemas = [];

  const vistos = new Set();
  const cobertura = new Map(personalidade.ordem.map((id) => [id, []]));

  for (const caso of casos) {
    const onde = `${caso.arquivo} · ${caso.id || "(sem id)"}`;

    if (!caso.id) problemas.push(`${onde}: caso sem id`);
    if (vistos.has(caso.id)) problemas.push(`${onde}: id repetido`);
    vistos.add(caso.id);

    if (!caso.titulo) problemas.push(`${onde}: caso sem título`);
    if (!Array.isArray(caso.regras) || caso.regras.length === 0) {
      problemas.push(`${onde}: caso não declara nenhum comportamento em "regras"`);
    }
    if (!caso.contexto || !caso.contexto.quando) {
      problemas.push(`${onde}: caso sem contexto.quando`);
    } else if (Number.isNaN(new Date(caso.contexto.quando).getTime())) {
      problemas.push(`${onde}: contexto.quando não é uma data válida`);
    }
    if (!Array.isArray(caso.turnos) || caso.turnos.length === 0) {
      problemas.push(`${onde}: caso sem turnos`);
    }

    for (const id of caso.regras || []) {
      if (!cobertura.has(id)) {
        problemas.push(`${onde}: aponta pro comportamento "${id}", que não existe na personalidade`);
      } else {
        cobertura.get(id).push(caso.id);
      }
    }

    for (const [i, turno] of (caso.turnos || []).entries()) {
      if (typeof turno.usuario !== "string" || !turno.usuario.trim()) {
        problemas.push(`${onde}: turno ${i + 1} sem mensagem do usuário`);
      }
      for (const chave of Object.keys(turno.esperado || {})) {
        if (!ASSERCOES_CONHECIDAS.has(chave)) {
          problemas.push(`${onde}: turno ${i + 1} usa asserção desconhecida "${chave}"`);
        }
      }
    }
  }

  const descobertos = [...cobertura.entries()].filter(([, casosDaRegra]) => casosDaRegra.length === 0);
  for (const [id] of descobertos) {
    const regra = personalidade.regras.get(id);
    problemas.push(`comportamento sem nenhum caso de regressão: "${id}" (${regra.titulo})`);
  }

  const turnos = casos.reduce((soma, c) => soma + (c.turnos || []).length, 0);
  console.log(`\n${casos.length} casos · ${turnos} turnos · ${personalidade.ordem.length} comportamentos`);

  const invariantes = personalidade.ordem.filter((id) => !personalidade.regras.get(id).ajustavel);
  const invariantesCobertos = invariantes.filter((id) => cobertura.get(id).length > 0);
  console.log(`invariantes cobertos: ${invariantesCobertos.length} de ${invariantes.length}`);

  const ranking = [...cobertura.entries()].sort((a, b) => a[1].length - b[1].length).slice(0, 5);
  console.log(`\ncomportamentos com menos casos:`);
  for (const [id, casosDaRegra] of ranking) {
    console.log(`  ${String(casosDaRegra.length).padStart(2)}  ${id}`);
  }

  if (problemas.length) {
    console.log(`\n${problemas.length} problema(s):`);
    for (const p of problemas) console.log(`  - ${p}`);
    process.exit(1);
  }

  console.log(`\nCorpus íntegro. Todos os ${personalidade.ordem.length} comportamentos têm caso.`);
}

main();
