// Lê o prompt REAL da Carla que está em produção (cerebro-ia.js, na raiz do repo) sem
// precisar carregar o módulo inteiro — cerebro-ia.js depende de baileys, googleapis,
// @anthropic-ai/sdk e da pasta carla-app/, e nada disso é necessário aqui.
//
// A função montarSystemPrompt() só usa global.CARLA_CONFIG, então dá pra extrair o
// texto-fonte dela e executá-lo isolado. Isso é o que torna a verificação de
// equivalência honesta: o alvo da comparação é o código que está no ar de verdade,
// não uma cópia colada aqui que poderia envelhecer sem ninguém perceber.

const fs = require("fs");
const path = require("path");

const CEREBRO = path.join(__dirname, "..", "..", "cerebro-ia.js");

function carregarFonte() {
  return fs.readFileSync(CEREBRO, "utf8");
}

// Recorta o corpo do template literal de montarSystemPrompt (o `return \`...\`;`).
// O prompt não contém nenhuma crase, então o primeiro "`;" depois do "return `" é
// realmente o fim do template. Se isso mudar um dia, o assert abaixo avisa.
function extrairTemplate(fonte) {
  const inicioFn = fonte.indexOf("function montarSystemPrompt");
  if (inicioFn === -1) throw new Error("montarSystemPrompt não encontrada em cerebro-ia.js");

  const inicioTpl = fonte.indexOf("return `", inicioFn);
  const fimTpl = fonte.indexOf("`;", inicioTpl + 8);
  if (inicioTpl === -1 || fimTpl === -1) throw new Error("template do prompt não delimitado");

  const corpo = fonte.slice(inicioTpl + 8, fimTpl);
  if (corpo.includes("`")) throw new Error("o prompt passou a conter crase — recorte inválido");
  return corpo;
}

// Os dois textos de primeira mensagem ficam antes do return, num ternário sobre
// pacienteConhecido. Recorta os dois template literals na ordem em que aparecem.
function extrairBlocosPrimeiraMensagem(fonte) {
  const inicio = fonte.indexOf("const blocoPrimeiraMensagem");
  const fim = fonte.indexOf("return `", inicio);
  const trecho = fonte.slice(inicio, fim);

  const partes = [];
  let i = 0;
  while (partes.length < 2) {
    const a = trecho.indexOf("`", i);
    if (a === -1) break;
    const b = trecho.indexOf("`", a + 1);
    if (b === -1) break;
    partes.push(trecho.slice(a + 1, b));
    i = b + 1;
  }
  if (partes.length !== 2) throw new Error("não achei os dois blocos de primeira mensagem");

  // A ordem no ternário é: conhecido ? A : B
  return { conhecido: partes[0], novo: partes[1] };
}

// Executa a montarSystemPrompt de verdade, isolada, com o CARLA_CONFIG informado.
function montarPromptDeProducao(now, pacienteConhecido, carlaConfig) {
  const fonte = carregarFonte();
  const inicio = fonte.indexOf("function montarSystemPrompt");
  const fimTpl = fonte.indexOf("`;", fonte.indexOf("return `", inicio));
  const corpoFn = fonte.slice(inicio, fimTpl + 2) + "\n}";

  const anterior = global.CARLA_CONFIG;
  global.CARLA_CONFIG = carlaConfig;
  try {
    // eslint-disable-next-line no-new-func
    const fabrica = new Function(`${corpoFn}; return montarSystemPrompt;`);
    return fabrica()(now, pacienteConhecido);
  } finally {
    global.CARLA_CONFIG = anterior;
  }
}

module.exports = {
  CEREBRO,
  carregarFonte,
  extrairTemplate,
  extrairBlocosPrimeiraMensagem,
  montarPromptDeProducao,
};
