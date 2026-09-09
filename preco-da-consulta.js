// Quanto custa a consulta daquele horário.
//
// O Dr. Bruno tem dois valores: R$ 550 de segunda a sexta, R$ 800 no fim de semana. Até
// agora isso vivia só no texto do prompt, então errar era mandar uma frase errada. Depois
// que a Carla passou a gerar cobrança de verdade, errar virou cobrar o valor errado de uma
// família — então a conta saiu do prompt e veio pra cá.
//
// O BURACO QUE ISTO FECHA. A grade padrão não tem sábado nem domingo, e quando a família
// pergunta sobre fim de semana a Carla escala em vez de marcar. Só que adicionarHorarioExtra
// não tem trava de dia: o Dr. Bruno abre um extra num sábado pelo painel, aquele horário
// entra na roda como qualquer outro, e a Carla marcava cobrando R$ 550.
//
// E abrir esse extra é justamente ele dizendo que vai atender naquele sábado. O certo não é
// impedir a marcação, é cobrar o que ela vale.

const SEMANA_CENTAVOS = Number(process.env.PRECO_CONSULTA_CENTAVOS || 55000);
const FIM_DE_SEMANA_CENTAVOS = Number(process.env.PRECO_FIM_DE_SEMANA_CENTAVOS || 80000);

function ehFimDeSemana(slot) {
  const [ano, mes, dia] = String(slot && slot.date).split("-").map(Number);
  if (!ano || !mes || !dia) return false;
  const diaSemana = new Date(ano, mes - 1, dia).getDay();
  return diaSemana === 0 || diaSemana === 6;
}

// slot: { date: "AAAA-MM-DD", ... }
// Devolve { centavos, fimDeSemana, reais } — o texto em reais serve pra mensagem e pro log.
function precoDaConsulta(slot) {
  const fds = ehFimDeSemana(slot);
  const centavos = fds ? FIM_DE_SEMANA_CENTAVOS : SEMANA_CENTAVOS;
  return {
    centavos,
    fimDeSemana: fds,
    reais: `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`,
  };
}

// IRMÃOS AGENDADOS JUNTOS. Uma criança custa R$ 550. Duas ou mais crianças da mesma família,
// marcadas juntas (mesmo telefone, mesmo dia), custam R$ 500 CADA: 2 = R$ 1.000, 3 = R$ 1.500,
// num pagamento só. Não é negociação nem desconto de balcão: é preço de tabela, automático,
// e é a ÚNICA exceção ao "valor único" (o prompt diz isso com todas as letras).
//
// A conta mora aqui, e não no prompt, pelo mesmo motivo do resto do arquivo: o valor que a
// Carla escreve é conferido pela máquina antes de qualquer reserva (precoFoiInformado). Se o
// prompt dissesse "R$ 1.000" e a máquina calculasse 2 x R$ 550, ela ficaria travada em loop
// sem conseguir marcar nenhuma das duas.
//
// O que sobra depois de um cancelamento NÃO tem preço congelado: quem calcula é sempre o
// grupo ATUAL. Cancelou um de dois, o que ficou volta a R$ 550 sozinho.
//
// Fim de semana não entra nessa conta: continua R$ 800 por criança, e a Carla nem marca fim
// de semana sozinha (escala pro Dr. Bruno).
const IRMAOS_POR_CRIANCA_CENTAVOS = Number(process.env.PRECO_IRMAOS_POR_CRIANCA_CENTAVOS || 50000);

// "R$ 1.000,00", com o ponto de milhar: é assim que a família lê, e é assim que a Carla
// precisa escrever pra máquina reconhecer o valor de volta (ver precoParticularInformado).
function reais(centavos) {
  const [inteiro, dec] = (centavos / 100).toFixed(2).split(".");
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

// slot: { date }, quantidade: crianças da mesma família marcadas juntas nesse dia (>= 1).
// Devolve o TOTAL do grupo em centavos, e o valor por criança, os dois em texto também.
function precoDoGrupo(slot, quantidade = 1) {
  const n = Math.max(1, Math.floor(Number(quantidade) || 1));
  const fds = ehFimDeSemana(slot);
  const porCrianca = fds ? FIM_DE_SEMANA_CENTAVOS : (n >= 2 ? IRMAOS_POR_CRIANCA_CENTAVOS : SEMANA_CENTAVOS);
  const centavos = porCrianca * n;
  return {
    quantidade: n,
    irmaos: !fds && n >= 2,
    fimDeSemana: fds,
    porCriancaCentavos: porCrianca,
    porCrianca: reais(porCrianca),
    centavos,
    reais: reais(centavos),
  };
}

// Os totais que existem de verdade, pra quem precisa reconhecer um valor escrito numa
// mensagem (server.js) sem depender de lista digitada à mão. Até 5 crianças é mais do que
// qualquer família traz numa manhã.
function totaisDeGrupoConhecidos(maximo = 5) {
  const lista = [];
  for (let n = 2; n <= maximo; n++) lista.push(precoDoGrupo({ date: "2026-01-05" }, n).centavos);
  return lista;
}

module.exports = {
  precoDaConsulta, precoDoGrupo, totaisDeGrupoConhecidos, ehFimDeSemana,
  SEMANA_CENTAVOS, FIM_DE_SEMANA_CENTAVOS, IRMAOS_POR_CRIANCA_CENTAVOS,
};
