// Quanto custa a consulta: depende do TIPO, e o tipo depende do que a família procura.
//
// Três tipos, três preços (decisão do Dr. Bruno, 10/09/2026):
//
//   urgência      R$ 350   queixa aguda do momento. Não vira puericultura nem investigação.
//                          Não existe por teleconsulta. É a ÚNICA que existe no fim de
//                          semana, e aí custa R$ 600.
//   puericultura  R$ 450   rotina, crescimento, vacinas, desenvolvimento normal.
//   tnd           R$ 550   investigação ou acompanhamento de transtornos do neurodesenvolvimento
//                          (autismo, TDAH, TOD) e outros motivos de saúde mental.
//
// Teleconsulta: puericultura e tnd, mesmo preço da presencial. Urgência não.
// Irmãos: não existe mais preço de grupo. Cada criança é uma consulta do seu tipo.
//
// POR QUE ISSO MORA AQUI E NÃO NO PROMPT. O valor que a Carla escreve é lido de volta e
// conferido pela máquina antes de qualquer reserva (precoFoiInformado). Se o prompt dissesse
// um número e este arquivo calculasse outro, ela ficaria travada em loop sem conseguir
// marcar. Então a tabela é uma só, e é esta.

const TIPOS = {
  urgencia: {
    nome: "consulta de urgência",
    centavos: Number(process.env.PRECO_URGENCIA_CENTAVOS || 35000),
    fimDeSemanaCentavos: Number(process.env.PRECO_URGENCIA_FIM_DE_SEMANA_CENTAVOS || 60000),
    teleconsulta: false,
  },
  puericultura: {
    nome: "consulta de puericultura",
    centavos: Number(process.env.PRECO_PUERICULTURA_CENTAVOS || 45000),
    teleconsulta: true,
  },
  tnd: {
    nome: "consulta de investigação ou acompanhamento de transtornos do neurodesenvolvimento",
    centavos: Number(process.env.PRECO_TND_CENTAVOS || 55000),
    teleconsulta: true,
  },
};

function ehFimDeSemana(slot) {
  const [ano, mes, dia] = String(slot && slot.date).split("-").map(Number);
  if (!ano || !mes || !dia) return false;
  const diaSemana = new Date(ano, mes - 1, dia).getDay();
  return diaSemana === 0 || diaSemana === 6;
}

function reais(centavos) {
  const [inteiro, dec] = (centavos / 100).toFixed(2).split(".");
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

function tipoValido(tipo) {
  return Object.prototype.hasOwnProperty.call(TIPOS, String(tipo || ""));
}

function permiteTeleconsulta(tipo) {
  return tipoValido(tipo) && TIPOS[tipo].teleconsulta === true;
}

// slot: { date }, tipo: "urgencia" | "puericultura" | "tnd".
// Devolve { valido, motivoInvalido, tipo, nome, centavos, reais, fimDeSemana }.
// Inválido NÃO é erro de programa: é a Carla tentando marcar algo que a tabela não tem
// (tipo desconhecido, ou puericultura/tnd num sábado). O motivo volta pra ela em texto.
function precoDaConsulta(slot, tipo) {
  const fds = ehFimDeSemana(slot);
  if (!tipoValido(tipo)) {
    return { valido: false, fimDeSemana: fds, motivoInvalido: "Tipo de consulta desconhecido. Use urgencia, puericultura ou tnd." };
  }
  const def = TIPOS[tipo];
  if (fds && !def.fimDeSemanaCentavos) {
    return {
      valido: false, tipo, nome: def.nome, fimDeSemana: true,
      motivoInvalido: `Fim de semana só tem consulta de urgência. ${def.nome} não é marcada em sábado ou domingo.`,
    };
  }
  const centavos = fds ? def.fimDeSemanaCentavos : def.centavos;
  return { valido: true, tipo, nome: def.nome, centavos, reais: reais(centavos), fimDeSemana: fds };
}

// Todos os valores que existem de verdade, pra quem precisa reconhecer um preço escrito
// numa mensagem (precoParticularInformado, no server.js) sem lista digitada à mão.
function valoresConhecidos() {
  const lista = new Set();
  for (const def of Object.values(TIPOS)) {
    lista.add(def.centavos);
    if (def.fimDeSemanaCentavos) lista.add(def.fimDeSemanaCentavos);
  }
  return [...lista].sort((a, b) => a - b);
}

module.exports = { TIPOS, precoDaConsulta, valoresConhecidos, tipoValido, permiteTeleconsulta, ehFimDeSemana, reais };
