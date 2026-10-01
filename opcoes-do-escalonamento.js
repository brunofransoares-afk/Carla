"use strict";

/*
 * OS BOTÕES QUE O DR. BRUNO VÊ QUANDO A CARLA ESCALA.
 *
 * O dono, em 01/10/2026: "para todos os outros motivos no qual eu sou escalonado, eu gostaria
 * também que você fizesse uma revisão nas opções, deixasse sempre três opções pertinentes
 * referente àquele escalonamento, ao motivo daquele escalonamento."
 *
 * QUEM MONTA OS BOTÕES É O CÓDIGO, NÃO A IA, e essa é a decisão que faz isto funcionar. A
 * Carla já podia mandar opções, e o resultado era irregular: às vezes três, às vezes duas, às
 * vezes rótulos compridos demais pra caberem na tela, às vezes nenhuma. Ela passa a escolher
 * só o MOTIVO, de uma lista fechada e curta, e o motivo decide os botões. Lista fechada o
 * modelo acerta; redação de botão, não.
 *
 * O VALOR DE CADA BOTÃO É O QUE VOLTA PRA ELA como resposta do Dr. Bruno, então ele é escrito
 * como instrução, e não como rótulo: "Não consigo nesse horário" é o que ele lê; o que ela
 * recebe diz também o que fazer em seguida. Era aí que a conversa morria depois de uma
 * resposta curta: ele clicava "não", e ela não sabia se oferecia outra coisa ou encerrava.
 *
 * DOIS MOTIVOS NÃO MORAM AQUI, e os dois têm razão própria:
 *   - "pagamento": a máquina precisa saber QUAL reserva o Sim marca, então os botões saem de
 *     alertaDePagamento, em server.js, que olha as reservas abertas daquele telefone.
 *   - "encaixe": o painel desenha um campo de horário, porque a hora é dele, não de uma lista.
 *
 * Uso: node tests/opcoes-do-escalonamento.test.js
 */

// O primeiro botão de "horario" vale "sim" de propósito: é esse valor que faz o painel abrir
// o horário pedido na agenda (ver /api/responder-escalada). Mudar esse texto desliga a
// abertura automática sem erro nenhum aparecer, e tem teste trancando isso.
const POR_MOTIVO = {
  horario: [
    { rotulo: "Consigo nesse horário", valor: "sim" },
    { rotulo: "Nesse dia não", valor: "Nesse dia eu não consigo esse horário. Ofereça os horários que existem na agenda, sem prometer outro dia." },
    { rotulo: "Em nenhum dia", valor: "Esse horário não dá em nenhum dia. Diga isso com naturalidade e ofereça os horários que existem na agenda." },
  ],
  tipo: [
    { rotulo: "Urgência", valor: "urgencia" },
    { rotulo: "Puericultura", valor: "puericultura" },
    { rotulo: "Neurodesenvolvimento", valor: "tnd" },
  ],
  valor: [
    { rotulo: "O valor é esse mesmo", valor: "O valor é o de tabela, sem exceção. Diga isso com gentileza, sem constranger, e deixe a porta aberta." },
    { rotulo: "Pode parcelar", valor: "Pode oferecer o parcelamento em até 3x sem juros no cartão pra essa família." },
    { rotulo: "Eu falo com ela", valor: "Eu mesmo vou falar com essa família. Diga que o Dr. Bruno vai responder pessoalmente por aqui e não ofereça mais nada." },
  ],
  fim_de_semana: [
    { rotulo: "Consigo atender", valor: "sim" },
    { rotulo: "Nesse fim de semana não", valor: "Nesse fim de semana eu não atendo. Ofereça os horários de semana que existem na agenda." },
    { rotulo: "Só na semana", valor: "Não vou atender em fim de semana. Ofereça os horários de semana que existem na agenda." },
  ],
  outro: [
    { rotulo: "Sim", valor: "sim" },
    { rotulo: "Não", valor: "nao" },
    // O terceiro não é enfeite pra fechar três: é o caso real de ele ler o escalonamento e
    // não conseguir decidir com o que está escrito ali.
    { rotulo: "Peça mais detalhes", valor: "Antes de eu decidir, pergunte à família os detalhes que faltam nessa situação e me traga de volta." },
  ],
};

const MOTIVOS = Object.keys(POR_MOTIVO);

// Os motivos que a ferramenta aceita. "pagamento" e "encaixe" entram aqui porque a IA precisa
// poder escolhê-los, mesmo os botões deles vindo de outro lugar.
const MOTIVOS_DA_FERRAMENTA = ["pagamento", "encaixe", "horario", "tipo", "valor", "fim_de_semana", "outro"];

function normalizarMotivo(bruto) {
  return MOTIVOS_DA_FERRAMENTA.includes(bruto) ? bruto : "outro";
}

/*
 * Os botões daquele escalonamento. Devolve null quando o motivo tem caminho próprio
 * (pagamento, encaixe): null quer dizer "não é aqui", e não "sem botões".
 *
 * Só monta botões quando existe PERGUNTA. Alerta sem pergunta é o caso em que ele precisa
 * mesmo ler e responder com as palavras dele (uma reclamação grave, um caso confuso), e três
 * botões ali empurrariam uma resposta pronta pra uma situação que não cabe em nenhuma.
 */
function opcoesDoEscalonamento(motivo, { temPergunta = true } = {}) {
  if (!temPergunta) return null;
  const m = normalizarMotivo(motivo);
  if (m === "pagamento" || m === "encaixe") return null;
  return POR_MOTIVO[m].map((o) => ({ rotulo: o.rotulo, valor: o.valor }));
}

module.exports = { opcoesDoEscalonamento, normalizarMotivo, MOTIVOS, MOTIVOS_DA_FERRAMENTA, POR_MOTIVO };
