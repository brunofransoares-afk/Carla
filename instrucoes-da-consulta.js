// As instruções que vão nas mensagens fixas da consulta (confirmação de pagamento, lembrete
// da semana antes e lembrete do dia), escolhidas pela MODALIDADE da reserva. Antes, as três
// mensagens mandavam endereço, mapa, "o que levar" e aviso de atraso pra todo mundo, e uma
// família de teleconsulta recebia o endereço do consultório sem uma palavra sobre vídeo
// (auditoria de 10/09, problema 11). É módulo puro: recebe a reserva e os links, devolve texto.
"use strict";

const O_QUE_LEVAR = "O que levar: carteira de vacinação, exames recentes se tiver, e os remédios que a criança usa.";
const O_QUE_TER_POR_PERTO = "Deixa por perto: carteira de vacinação, exames recentes se tiver, e os remédios que a criança usa.";

function ehTeleconsulta(reserva) {
  return !!reserva && reserva.modalidade === "teleconsulta";
}

// "consulta" ou "teleconsulta", pra frase dizer o que é.
function nomeDaConsulta(reserva) {
  return ehTeleconsulta(reserva) ? "teleconsulta" : "consulta";
}

// Presencial: endereço e mapa. Teleconsulta: que é por vídeo e como chega o link. Sem
// LINK_TELECONSULTA no .env, a mensagem promete o link por aqui antes da consulta, e aí é
// o Dr. Bruno quem manda; com o link configurado, ele já vai na mensagem.
function blocoDoLocal(reserva, { endereco, linkMapa, linkTeleconsulta = null } = {}) {
  if (ehTeleconsulta(reserva)) {
    const link = String(linkTeleconsulta || "").trim();
    return `A consulta é por vídeo, no horário combinado.\n${link ? `Link da chamada: ${link}` : "O link da chamada chega por aqui antes da consulta."}`;
  }
  return `Endereço: ${endereco}\n${linkMapa}`;
}

function blocoDoQueLevar(reserva) {
  return ehTeleconsulta(reserva) ? O_QUE_TER_POR_PERTO : O_QUE_LEVAR;
}

// Atraso só faz sentido pra quem se desloca. Por vídeo, o que sobra é remarcar.
function avisoDeAtraso(reserva, momento) {
  if (momento === "dia") {
    return ehTeleconsulta(reserva) ? "Se precisar remarcar, me avisa por aqui. Até já! 😊" : "Se for atrasar, me avisa por aqui. Até já! 😊";
  }
  return ehTeleconsulta(reserva) ? "Se precisar remarcar, é só me avisar por aqui." : "Se precisar remarcar ou for atrasar, é só me avisar por aqui.";
}

module.exports = { O_QUE_LEVAR, O_QUE_TER_POR_PERTO, ehTeleconsulta, nomeDaConsulta, blocoDoLocal, blocoDoQueLevar, avisoDeAtraso };
