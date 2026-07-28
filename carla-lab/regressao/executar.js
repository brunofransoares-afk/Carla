// Roda a suíte contra a Carla de verdade.
//
// Precisa de três coisas que só existem no servidor ou no staging:
//   ANTHROPIC_API_KEY, a pasta carla-app/ e node_modules/.
// Por isso este arquivo não roda no ambiente de desenvolvimento, e ele diz isso em vez
// de fingir que passou.
//
//   node carla-lab/regressao/executar.js [--caso id] [--arquivo 03-agendamento.json]
//
// LIMITE CONHECIDO E DELIBERADO
// A API pública de cerebro-ia.js (responder) devolve os EFEITOS de uma resposta
// (acoes, cancelamentos, escalar, escalarTipo, silêncio), não a lista de ferramentas
// chamadas. Então asserções de nível de ferramenta (deveChamar, deveChamarComArgumento)
// não são verificáveis sem alterar o código de produção, o que esta fase não faz.
// Elas saem como PENDENTE, nunca como aprovadas. A observabilidade entra na Fase 2,
// quando as ferramentas viram porta explícita.

const fs = require("fs");
const path = require("path");

const DIR_CASOS = path.join(__dirname, "casos");

const NAO_OBSERVAVEIS = new Set([
  "deveChamar",
  "naoDeveChamar",
  "deveChamarComArgumento",
  "maxHorariosOferecidos",
  "naoDeveRepetirHorariosDoTurnoAnterior",
  "seChamouFerramentaDeveConter",
  "seNaoChamouFerramentaNaoDeveConter",
  "naoDeveContinuarAssunto",
]);

function normalizar(t) {
  return String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function conferirPreRequisitos() {
  const faltando = [];
  if (!process.env.ANTHROPIC_API_KEY) faltando.push("ANTHROPIC_API_KEY não está definida");
  if (!fs.existsSync(path.join(__dirname, "..", "..", "..", "carla-app"))) {
    faltando.push("a pasta carla-app/ não está ao lado do repositório");
  }
  if (!fs.existsSync(path.join(__dirname, "..", "..", "node_modules"))) {
    faltando.push("node_modules/ não existe (rode npm install)");
  }
  return faltando;
}

function avaliar(esperado, resultado, contexto) {
  const falhas = [];
  const pendentes = [];
  const texto = resultado.resposta === null ? "SILENCIO" : resultado.resposta;
  const norm = normalizar(texto);

  for (const [chave, valor] of Object.entries(esperado || {})) {
    if (NAO_OBSERVAVEIS.has(chave)) {
      pendentes.push(chave);
      continue;
    }

    switch (chave) {
      case "deveConter":
        for (const t of valor) if (!norm.includes(normalizar(t))) falhas.push(`faltou "${t}"`);
        break;
      case "deveConterAlgum":
        if (!valor.some((t) => norm.includes(normalizar(t)))) {
          falhas.push(`não continha nenhum de: ${valor.join(" | ")}`);
        }
        break;
      case "naoDeveConter":
        for (const t of valor) if (norm.includes(normalizar(t))) falhas.push(`continha "${t}"`);
        break;
      case "naoDeveConterAmbos":
        if (valor.every((t) => norm.includes(normalizar(t)))) {
          falhas.push(`continha os dois juntos: ${valor.join(" + ")}`);
        }
        break;
      case "naoDeveConterExatamente":
        for (const t of valor) if (texto.includes(t)) falhas.push(`copiou o exemplo literal "${t}"`);
        break;
      case "naoDeveComecarCom":
        for (const t of valor) if (norm.startsWith(normalizar(t))) falhas.push(`começou com "${t}"`);
        break;
      case "naoDeveTerApenas":
        for (const t of valor) {
          if (norm.includes(normalizar(t)) && !texto.includes("?")) {
            falhas.push(`disse "${t}" sem pergunta nem ação junto`);
          }
        }
        break;
      case "respostaExata":
        if (texto.trim() !== valor) falhas.push(`esperava exatamente "${valor}", veio "${texto.trim()}"`);
        break;
      case "maxCaracteres":
        if (texto.length > valor) falhas.push(`resposta com ${texto.length} caracteres (teto ${valor})`);
        break;
      case "contarNoMaximo":
        for (const [termo, teto] of Object.entries(valor)) {
          const n = norm.split(normalizar(termo)).length - 1;
          if (n > teto) falhas.push(`"${termo}" apareceu ${n}x (teto ${teto})`);
        }
        break;
      case "deveTerPergunta":
      case "deveTerPerguntaOuFerramenta":
        if (!texto.includes("?") && resultado.acoes.length === 0) falhas.push("não perguntou nem agiu");
        break;
      case "deveSerTratadoComoEmergencia":
        if (!contexto.emergencia) falhas.push("não foi detectado como emergência");
        break;
      case "naoDeveChamarIA":
        if (!contexto.emergencia) falhas.push("a mensagem chegou até a IA");
        break;
      default:
        pendentes.push(chave);
    }
  }

  return { falhas, pendentes };
}

async function main() {
  const faltando = conferirPreRequisitos();
  if (faltando.length) {
    console.log("\nNão dá pra rodar a suíte aqui:");
    for (const f of faltando) console.log(`  - ${f}`);
    console.log("\nEste executor roda no servidor ou no ambiente de staging.");
    console.log("Para conferir a integridade do corpus sem chave de API, use:");
    console.log("  node carla-lab/regressao/verificar-cobertura.js\n");
    process.exit(2);
  }

  const CerebroIA = require(path.join(__dirname, "..", "..", "cerebro-ia.js"));

  const filtroArquivo = process.argv.includes("--arquivo")
    ? process.argv[process.argv.indexOf("--arquivo") + 1]
    : null;
  const filtroCaso = process.argv.includes("--caso")
    ? process.argv[process.argv.indexOf("--caso") + 1]
    : null;

  const arquivos = fs
    .readdirSync(DIR_CASOS)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => !filtroArquivo || f === filtroArquivo)
    .sort();

  let aprovados = 0;
  const reprovados = [];
  const pendentes = new Set();

  for (const arquivo of arquivos) {
    for (const caso of JSON.parse(fs.readFileSync(path.join(DIR_CASOS, arquivo), "utf8"))) {
      if (filtroCaso && caso.id !== filtroCaso) continue;

      const now = new Date(caso.contexto.quando);
      // Telefone fictício e reservado: a suíte nunca escreve numa conversa real.
      const telefone = `55190000${String(Math.abs(hash(caso.id)) % 10000).padStart(4, "0")}`;
      let historico = [];
      const problemas = [];

      for (const [i, turno] of caso.turnos.entries()) {
        const emergencia = CerebroIA.pareceEmergencia(turno.usuario);
        let resultado = { resposta: null, acoes: [], cancelamentos: [], escalar: null };

        if (!emergencia) {
          resultado = await CerebroIA.responder({
            telefone,
            texto: turno.usuario,
            historico,
            now,
            idsOcupados: [],
            pacienteConhecido: !!caso.contexto.pacienteConhecido,
          });
          historico = resultado.historico;
        }

        const { falhas, pendentes: pend } = avaliar(turno.esperado, resultado, { emergencia });
        for (const p of pend) pendentes.add(p);
        for (const f of falhas) problemas.push(`turno ${i + 1} ("${turno.usuario.slice(0, 40)}"): ${f}`);
      }

      if (problemas.length) {
        reprovados.push({ caso, problemas });
        console.log(`  FALHOU  ${caso.id}`);
        for (const p of problemas) console.log(`          ${p}`);
      } else {
        aprovados += 1;
        console.log(`  ok      ${caso.id}`);
      }
    }
  }

  console.log(`\n${aprovados} aprovados · ${reprovados.length} reprovados`);
  if (pendentes.size) {
    console.log(`\nAsserções não verificáveis nesta fase (falta observabilidade de ferramenta):`);
    console.log(`  ${[...pendentes].join(", ")}`);
    console.log(`  Elas NÃO contam como aprovadas. Entram na Fase 2.`);
  }
  process.exit(reprovados.length ? 1 : 0);
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
