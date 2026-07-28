// A rede de segurança do laboratório.
//
// Compara, byte a byte, o prompt montado pelo compositor com o prompt que a Carla de
// produção monta hoje. Enquanto isso passar, o laboratório é uma reorganização do que
// já existe, não um comportamento novo — e qualquer divergência aparece aqui antes de
// chegar perto de uma família.
//
// A comparação usa o cerebro-ia.js real do repositório. Se alguém mudar o prompt em
// produção, este teste quebra na hora e avisa que o laboratório ficou pra trás.
//
//   node carla-lab/ferramentas/verificar-equivalencia.js

const ref = require("../nucleo/prompt-referencia.js");
const { lerPerfil, lerPersonalidade, montarPrompt } = require("../nucleo/compositor.js");

// Datas escolhidas pra cobrir os casos que o prompt trata de forma diferente:
// dia de atendimento, o dia fechado da semana, e os dois dias de fim de semana.
const DATAS = [
  ["segunda de manhã", new Date(2026, 6, 27, 9, 5)],
  ["quarta (dia fechado)", new Date(2026, 6, 29, 14, 30)],
  ["sexta à noite", new Date(2026, 6, 31, 19, 45)],
  ["sábado", new Date(2026, 7, 1, 10, 0)],
  ["domingo", new Date(2026, 7, 2, 16, 20)],
];

function primeiraDiferenca(a, b) {
  const limite = Math.min(a.length, b.length);
  let i = 0;
  while (i < limite && a[i] === b[i]) i += 1;
  const janela = (s) => JSON.stringify(s.slice(Math.max(0, i - 60), i + 60));
  return [
    `  primeira diferença no caractere ${i} (produção tem ${a.length}, laboratório tem ${b.length})`,
    `  produção...: ${janela(a)}`,
    `  laboratório: ${janela(b)}`,
  ].join("\n");
}

function main() {
  const perfil = lerPerfil();
  const personalidade = lerPersonalidade();
  const carlaConfig = { nomesDiaSemana: perfil.nomesDiaSemana };

  let passou = 0;
  const falhas = [];

  for (const [rotulo, now] of DATAS) {
    for (const conhecido of [false, true]) {
      const caso = `${rotulo} · ${conhecido ? "paciente conhecido" : "primeiro contato"}`;
      const producao = ref.montarPromptDeProducao(now, conhecido, carlaConfig);
      const laboratorio = montarPrompt({ now, pacienteConhecido: conhecido, perfil, personalidade });

      if (producao === laboratorio) {
        passou += 1;
        console.log(`  ok   ${caso}  (${producao.length} caracteres)`);
      } else {
        falhas.push(`  FALHOU  ${caso}\n${primeiraDiferenca(producao, laboratorio)}`);
      }
    }
  }

  console.log("");
  if (falhas.length) {
    console.log(falhas.join("\n\n"));
    console.log(`\n${passou} de ${passou + falhas.length} casos idênticos. O laboratório DIVERGIU da produção.`);
    process.exit(1);
  }

  console.log(`${passou} de ${passou} casos idênticos byte a byte.`);
  console.log(`Personalidade ${personalidade.versao}: ${personalidade.ordem.length} regras.`);
  console.log("O laboratório reproduz exatamente a Carla que está no ar.");
}

main();
