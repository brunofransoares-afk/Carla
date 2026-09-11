// A Carla não pergunta o que a agenda responde.
//
// Aconteceu (10/09, 09:02): a família perguntou do acompanhamento, a Carla explicou e
// fechou com "Você já tem uma consulta agendada, ou gostaria de marcar?". Ela SABE se tem:
// a agenda é dela, e o sistema já põe no prompt a consulta marcada daquele telefone (ou a
// ausência dela). Perguntar isso é o atendimento automático pedindo pra família fazer o
// trabalho dele, e soa exatamente como o chatbot que ela não pode parecer.
//
// O prompt passou a dizer isso com todas as letras (ver montarContextoDoAtendimento). Este
// módulo é a trava de máquina pra quando o prompt não segurar: lê a resposta antes de sair,
// arranca a frase que pergunta, e põe no lugar o que a agenda diz. É puro e testável.
"use strict";

// Só pergunta, nunca afirmação: "você já tem consulta marcada?" cai; "a consulta já está
// marcada pra quinta" não. A interrogação pode vir depois de mais texto na mesma frase
// ("...ou gostaria de marcar?"), por isso o teste é na FRASE, não no trecho.
const PERGUNTA_DE_AGENDA = /(já|ja)\s+(tem|possui|está com|esta com|marcou|agendou|fez)\s+(uma\s+|alguma\s+|a\s+)?(consulta|horário|horario|agendamento)|(tem|possui)\s+(uma\s+|alguma\s+)?(consulta|horário|horario)\s+(agendad[ao]|marcad[ao])|(consulta|horário|horario)\s+(agendad[ao]|marcad[ao])\s*(comigo|com o dr|aqui)?\s*(,|\?|ou)/i;

// PERGUNTAR SE EXISTE NÃO É PERGUNTAR O QUE FAZER COM ELA. "Você já tem consulta marcada?"
// é a Carla pedindo pra família fazer o trabalho dela. "Confirma que quer cancelar a consulta
// marcada de quinta?" é a confirmação que o próprio fluxo de cancelamento exige, em dois
// turnos, e arrancar essa frase deixava o cancelamento sem a pergunta que o conclui
// (auditoria de 10/09, problema 8). A frase que fala em cancelar, remarcar, desmarcar,
// adiar, transferir ou confirmar é sobre a consulta que JÁ existe: essa passa.
const OPERACAO_NA_CONSULTA = /\b(cancelar|cancelo|cancela|cancelamento|desmarcar|desmarco|desmarca|remarcar|remarco|remarca|remarcação|remarcacao|transferir|transfiro|transfere|adiar|adio|adia|antecipar|antecipo|confirmar|confirmo|confirma|manter|mantenho|mantém|mantem|mudar|mudo|muda|trocar|troco|troca)\b/i;

function ehPerguntaDeAgenda(frase) {
  if (OPERACAO_NA_CONSULTA.test(frase)) return false;
  return /\?/.test(frase) && PERGUNTA_DE_AGENDA.test(frase);
}

// Divide em frases sem perder os parágrafos: quebra de linha é fronteira também.
function frasesDe(texto) {
  return String(texto || "").split(/(?<=[.!?…])\s+|\n+/);
}

// consultaProxima: { crianca, diaLabel } ou null (o mesmo objeto que vai pro prompt).
function corrigirPerguntaDeAgenda(texto, consultaProxima = null) {
  const original = String(texto || "");
  const frases = frasesDe(original);
  if (!frases.some(ehPerguntaDeAgenda)) return { texto: original, corrigiu: false };

  // Um "😊" solto depois da interrogação vira fragmento próprio na divisão: sem letra nem
  // número, ele pertencia à frase arrancada e vai embora junto.
  const restante = frases.filter((f) => !ehPerguntaDeAgenda(f)).map((f) => f.trim()).filter((f) => /[\p{L}\p{N}]/u.test(f));
  const fecho = consultaProxima && consultaProxima.diaLabel
    ? `A consulta${consultaProxima.crianca ? ` de ${consultaProxima.crianca}` : ""} já está marcada pra ${consultaProxima.diaLabel}.`
    : "Se quiser marcar, me conta se prefere de manhã ou à tarde que eu vejo um horário.";
  const corpo = restante.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return { texto: corpo ? `${corpo}\n\n${fecho}` : fecho, corrigiu: true };
}

module.exports = { corrigirPerguntaDeAgenda, ehPerguntaDeAgenda, PERGUNTA_DE_AGENDA, OPERACAO_NA_CONSULTA };
