"use strict";

/*
 * O PEDIDO DO E-MAIL E DA DATA DE NASCIMENTO, escrito num lugar só.
 *
 * ESTES DOIS DADOS JÁ MUDARAM DE LUGAR UMA VEZ, e por um motivo real: eles iam na mensagem
 * da reserva, que ficava com cinco assuntos (horário, prazo, endereço, Pix, cartão), e a
 * família respondia um e esquecia o resto, quase sempre o e-mail. Foram movidos pra mensagem
 * de pagamento confirmado, onde ela acabou de pagar e está satisfeita.
 *
 * SÓ QUE ALI ELES CHEGAM TARDE DEMAIS. O dono, em 01/10/2026: "o paciente só vai receber
 * aquela mensagem da confirmação do pagamento e aí é nessa mensagem que pergunta e-mail...
 * não tá legal isso. Isso tem que ser perguntado depois que ela fechou a consulta, já escolheu
 * um horário, aí faz a pergunta, mas não precisa ter feito o pagamento."
 *
 * Ele está certo, e os dois problemas são verdadeiros ao mesmo tempo. Quem paga três dias
 * depois só é perguntado três dias depois; quem nunca paga nunca é perguntado, e o e-mail
 * some junto com a consulta. Mas voltar a empilhar isso na mensagem da reserva traz de volta
 * o problema de 2026-08.
 *
 * A SAÍDA É MENSAGEM PRÓPRIA. O pedido sai logo depois da reserva, SOZINHO, numa mensagem
 * curta que não disputa com preço nem endereço. E a mensagem de pagamento confirmado continua
 * pedindo o que AINDA faltar, que é a rede de segurança pra quem não respondeu.
 *
 * O texto mora aqui, e não nos dois lugares, porque duas cópias de uma mesma frase viram duas
 * frases diferentes na primeira vez que alguém mexer numa delas.
 *
 * Uso: node tests/pedido-de-dados.test.js
 */

function primeiroNome(nome) {
  return String(nome || "").trim().split(/\s+/)[0] || "";
}

// O que ainda falta daquele agendamento. O e-mail é do RESPONSÁVEL e serve pra qualquer filho
// dele; a data de nascimento é DA CRIANÇA e nunca serve pra outra.
function oQueFalta(agendamento) {
  const a = agendamento || {};
  const falta = [];
  if (!a.responsavelEmail) falta.push("email");
  if (!a.criancaDataNascimento) falta.push("nascimento");
  return falta;
}

// A explicação do PORQUÊ, que muda conforme o que falta: pedir dado sem dizer pra que serve é
// o jeito mais rápido de não receber resposta.
function motivo(agendamento) {
  const falta = oQueFalta(agendamento);
  const crianca = primeiroNome((agendamento || {}).crianca);
  if (falta.length === 1 && falta[0] === "nascimento") {
    return `É pra montar a curva de crescimento de ${crianca} no portal.`;
  }
  return `É pra criar o portal de ${crianca}: um espaço só de vocês, onde você guarda os exames, a carteira de vacinação e o peso e altura, e compara os exames antigos com os novos. As receitas e os documentos que o Dr. Bruno passar também ficam lá, junto com o crescimento e as vacinas que ainda faltam.`;
}

function listaDoQueFalta(agendamento) {
  const falta = oQueFalta(agendamento);
  const crianca = primeiroNome((agendamento || {}).crianca);
  return falta.map((o) => (o === "email" ? "seu *e-mail*" : `a data de nascimento de ${crianca}`)).join(" e ");
}

/*
 * A MENSAGEM SOZINHA, logo depois de o horário ficar separado. Vazia quando não falta nada:
 * quem adiantou os dados junto com os nomes não pode ser perguntado de novo, e é por isso
 * que esta conferência é código e não instrução de prompt.
 */
function mensagemDepoisDaReserva(agendamento) {
  if (!oQueFalta(agendamento).length) return "";
  return `Ah, e me manda ${listaDoQueFalta(agendamento)}? 😊\n\n${motivo(agendamento)}`;
}

/*
 * O TRECHO QUE ENTRA NA MENSAGEM DE PAGAMENTO CONFIRMADO, que é a rede de segurança: pega
 * quem não respondeu o pedido de cima. Começa com as quebras de linha porque ele é emendado
 * no fim de uma mensagem maior.
 */
function trechoNaConfirmacao(agendamento) {
  if (!oQueFalta(agendamento).length) return "";
  return `\n\nMe manda ${listaDoQueFalta(agendamento)}?\n\n${motivo(agendamento)}`;
}

module.exports = { oQueFalta, mensagemDepoisDaReserva, trechoNaConfirmacao, listaDoQueFalta, motivo };
