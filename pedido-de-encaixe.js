"use strict";

// URGÊNCIA QUE NÃO PODE ESPERAR VAI PRO DR. BRUNO, NA HORA (2026-10-02).
//
// O print: mãe escolheu urgência, a Carla ofereceu segunda-feira. "Ué, é consulta de
// urgência, não dá pra esperar até segunda, né", "você não consegue pedir um encaixe pro
// dr?", "você já me falou 3 vezes", "você precisa responder que vai ver com o dr, apenas
// isso". A Carla repetiu os horários três vezes, inventou que "já buscou com prioridade
// máxima" e ficou pedindo nome antes de escalar. O dono: "Eu não havia pedido para, caso a
// pessoa quiser a consulta de urgência e pedir encaixe para o dia, você simplesmente
// redirecionar para mim? Irritou a pessoa."
//
// A regra estava no prompt e não bastou. Aqui ela é código, antes da IA: na conversa de
// urgência (ou quando a própria mensagem fala de urgência), qualquer pedido de mais cedo,
// de encaixe, de hoje, ou "não dá pra esperar", escala e silencia. Sem pedir nome antes.
const URGENCIA_NA_MENSAGEM = /\burg[eê]n(cia|te)\b/i;

const PEDE_MAIS_CEDO = [
  /\bencaix/i,
  /\bhoje\b/i,
  /\bainda hoje\b/i,
  /\bo (quanto|mais) antes\b/i,
  /\bmais r[aá]pido\b/i,
  /\bn[aã]o (d[aá]|pode|posso|podemos|consigo|consegue|tem como|vai dar|vou conseguir) (pra |para |a )?esperar\b/i,
  /\bn[aã]o (d[aá]|tem como) (pra |para )?(segunda|ter[cç]a|quarta|quinta|sexta|amanh[aã]|semana que vem)/i,
  /\b(nada|algo|alguma coisa|nenhum hor[aá]rio) antes\b/i,
  /\b(ped\w*|pergunt\w*|fal\w*|v[eê]\w*|checa\w*|confirm\w*) (pro|pra|para o|para|ao|com o) (dr|doutor|m[eé]dico)\b/i,
];

function ehConversaDeUrgencia(tipoTravado, texto) {
  return tipoTravado === "urgencia" || URGENCIA_NA_MENSAGEM.test(String(texto || ""));
}

function pediuEncaixe(texto, { tipoTravado = null } = {}) {
  const t = String(texto || "");
  if (!t.trim()) return false;
  if (!ehConversaDeUrgencia(tipoTravado, t)) return false;
  // Com a urgência já escolhida, insistir que "é urgente" é pedir que alguém veja: a família
  // já ouviu os horários e está dizendo que eles não servem.
  if (tipoTravado === "urgencia" && URGENCIA_NA_MENSAGEM.test(t)) return true;
  return PEDE_MAIS_CEDO.some((r) => r.test(t));
}

// A mensagem que o dono escolheu pra esse momento.
const MENSAGEM = "Irei checar alguma possibilidade e te retorno.";

module.exports = { pediuEncaixe, ehConversaDeUrgencia, MENSAGEM };
