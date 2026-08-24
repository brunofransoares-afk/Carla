"use strict";

// Reaquecimento de lead: a família falou, não fechou, e sumiu. O Dr. Bruno aperta um botão
// no painel e a Carla volta a falar com ela UMA vez. Se a família responder, a conversa
// segue normal, sozinha.
//
// POR QUE ISSO É UM MÓDULO PURO. As travas e o texto do contexto são a parte que decide se
// alguém recebe ou não uma mensagem não solicitada. Isso precisa rodar em teste sem subir o
// WhatsApp, sem a agenda e sem a IA.
//
// O PROBLEMA DAS 4 HORAS. O histórico da conversa é apagado quando a família volta a
// escrever depois de 4h de silêncio (server.js, historicoExpirou). Repare no MOMENTO: a
// limpeza roda na chegada da mensagem. Então a conversa de três dias atrás de alguém que
// nunca mais escreveu ainda está inteira no sessoes.json — mas seria apagada exatamente
// quando a família respondesse ao reaquecimento, deixando a Carla sem memória no pior
// instante possível.
//
// A SAÍDA NÃO É AUMENTAR O PRAZO. Ressuscitar conversa velha traz de volta o defeito que
// aquela regra conserta: a Carla retomando um "Pix ou cartão?" pendente de outro assunto e
// puxando nome de criança de um turno antigo. Então o botão converte o passado em FATOS,
// uma vez, e guarda num campo que a limpeza não toca. Ela passa a saber O QUE ACONTECEU sem
// ter os TURNOS, e por isso não consegue "continuar" nada por engano.
//
// OS FATOS VÊM DO REGISTRO DE EVENTOS, não de ler a conversa: o funil já sabe se a família
// perguntou o valor, se recebeu horário e se agendou. É o mesmo dado, já estruturado.

const UM_DIA_MS = 24 * 60 * 60 * 1000;

// Conversa de hoje não é lead frio. Reaquecer alguém que falou há duas horas é atropelar uma
// conversa viva, e é o jeito mais rápido de irritar quem ainda estava decidindo.
const ESFRIA_EM_MS = UM_DIA_MS;

function diasEntre(depois, antes) {
  return Math.floor((new Date(depois).getTime() - new Date(antes).getTime()) / UM_DIA_MS);
}

// ---------------------------------------------------------------- as travas
//
// Ordem pensada: primeiro o que é proibição do próprio contato (silenciado, em atendimento
// humano), depois o que já foi resolvido (tem consulta), depois o que seria repetição.
// A mensagem de motivo é lida pelo Dr. Bruno no painel, então ela explica, não codifica.
function podeReaquecer(estado = {}, agora = new Date()) {
  const {
    silenciado = false,
    aguardandoHumano = false,
    temConsultaFutura = false,
    jaReaquecidoEm = null,
    ultimaAtividade = null,
    respondeuAlgumaVez = false,
  } = estado;

  if (silenciado) return { pode: false, motivo: "Este número está silenciado." };
  if (aguardandoHumano) return { pode: false, motivo: "A conversa está esperando você, não a Carla." };
  if (temConsultaFutura) return { pode: false, motivo: "Já tem consulta marcada." };
  if (jaReaquecidoEm) {
    return { pode: false, motivo: `Já foi reaquecido em ${new Date(jaReaquecidoEm).toLocaleDateString("pt-BR")}.` };
  }
  // A regra de ouro. Quem nunca respondeu nada não é lead esfriado: é número errado, engano
  // ou desinteresse total. É exatamente ali que mora a denúncia que derruba o número, e a
  // Carla roda num cliente não oficial do WhatsApp.
  if (!respondeuAlgumaVez) {
    return { pode: false, motivo: "Essa pessoa nunca respondeu nada. Reaquecer quem nunca falou é o que faz número ser bloqueado." };
  }
  if (!ultimaAtividade) return { pode: false, motivo: "Sem registro de conversa." };
  if (new Date(agora).getTime() - new Date(ultimaAtividade).getTime() < ESFRIA_EM_MS) {
    return { pode: false, motivo: "A conversa é de hoje. Espere esfriar antes de reaquecer." };
  }
  return { pode: true, motivo: null };
}

// ---------------------------------------------------------------- os fatos
//
// Texto factual, não conversa. Vai pro prompt do sistema (como o recado do Dr. Bruno já vai),
// nunca pro histórico: se entrasse como turno, a Carla trataria como coisa que a família
// disse e o anti-spoof do canal cairia junto.
function montarContexto(dados = {}, agora = new Date()) {
  const {
    ultimaAtividade = null, primeiraPergunta = null,
    recebeuPreco = false, recebeuHorario = false, crianca = null,
  } = dados;

  const partes = [];
  const dias = ultimaAtividade ? diasEntre(agora, ultimaAtividade) : null;
  if (dias === null) partes.push("Esta família já falou com você antes.");
  else if (dias <= 0) partes.push("Esta família falou com você hoje.");
  else if (dias === 1) partes.push("Esta família falou com você ontem.");
  else partes.push(`Esta família falou com você há ${dias} dias.`);

  if (crianca) partes.push(`A criança é ${crianca}.`);

  const porQue = {
    preco: "Ela perguntou o valor da consulta.",
    convenio: "Ela perguntou se o consultório atende convênio.",
    sintoma: "Ela contou o que estava acontecendo com a criança.",
    agendar: "Ela quis marcar uma consulta.",
  }[primeiraPergunta];
  if (porQue) partes.push(porQue);

  if (recebeuPreco) partes.push("Você já informou o valor.");
  if (recebeuHorario) partes.push("Você já ofereceu horário.");
  partes.push("Ela não respondeu depois disso e nenhuma consulta foi marcada.");

  return partes.join(" ");
}

// A instrução que acompanha os fatos. Fica aqui, junto deles, porque é a mesma decisão: o
// que a Carla pode e não pode fazer numa mensagem que a família NÃO pediu.
function montarInstrucao() {
  return [
    "VOCÊ ESTÁ RETOMANDO O CONTATO, e a família não pediu isso: quem tocou no assunto foi o consultório.",
    "Mande UMA mensagem curta, leve e sem cobrança. Cumprimente, retome o assunto pelo que ela procurou, e pergunte se ainda faz sentido, deixando fácil dizer que não.",
    "NÃO repita o valor, NÃO liste horário e NÃO chame nenhuma ferramenta agora: ela ainda não disse que quer seguir.",
    "NÃO peça desculpa por sumir e NÃO diga que notou a ausência dela, porque quem sumiu não foi ela, a conversa é que parou.",
    "Se ela responder que não tem mais interesse, aceite na hora, agradeça e encerre. Não ofereça nada em cima.",
  ].join(" ");
}

module.exports = { podeReaquecer, montarContexto, montarInstrucao, ESFRIA_EM_MS };
