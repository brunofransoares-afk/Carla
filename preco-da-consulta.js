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

module.exports = { precoDaConsulta, ehFimDeSemana, SEMANA_CENTAVOS, FIM_DE_SEMANA_CENTAVOS };
