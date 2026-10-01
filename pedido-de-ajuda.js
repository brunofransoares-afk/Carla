"use strict";

// "QUALQUER DIFICULDADE, DIGITE 9" (2026-10-01). O dono: "Se a pessoa digitar apenas '9' em
// uma mensagem, manda a msg de escalar, escala e silencia. Cuidado pra não considerar 9 em
// outras msgs como datas e etc."
//
// Decidido em código, antes da IA: é um atalho prometido na abertura, e atalho que às vezes
// funciona é pior do que nenhum.
//
// O QUE CONTA: a mensagem inteira é o 9, e nada mais ("9", " 9 ", "9.", "9!"). "Dia 9",
// "às 9", "9h", "09/10", "R$ 90", "9 meses" não contam, porque têm outra coisa junto.
//
// O CASO QUE ENGANA: o 9 sozinho como RESPOSTA. Se a Carla acabou de perguntar dia, horário
// ou período ("prefere manhã ou tarde?", "qual dia fica melhor?"), "9" é o dia 9 ou as 9h,
// não um pedido de ajuda. O mesmo se ela acabou de listar horários. Nesses casos segue pra
// IA, que entende a resposta pelo contexto.
const SO_O_NOVE = /^\s*9\s*[.!]?\s*$/;
const PERGUNTOU_QUANDO = /\b(manh[ãa]|tarde|noite|hor[áa]rio|hora|dia|data|quando|semana|m[êe]s|idade|anos?|meses)\b|\d{1,2}[:h]\d{0,2}|\d{1,2}\/\d{1,2}/i;

const MENSAGEM = "Certo! Já encaminhei sua conversa no consultório e te retorno por aqui 😊";

function textoDoTurno(conteudo) {
  if (typeof conteudo === "string") return conteudo;
  if (Array.isArray(conteudo)) return conteudo.filter((b) => b && b.type === "text").map((b) => b.text || "").join("\n");
  return "";
}

function pediuAjuda(texto, { historico = [], horariosOferecidos = [] } = {}) {
  if (!SO_O_NOVE.test(String(texto || ""))) return false;
  if (Array.isArray(horariosOferecidos) && horariosOferecidos.length) return false;
  const ultimaDaCarla = [...(historico || [])].reverse().find((m) => m && m.role === "assistant");
  // Na abertura a Carla escreve "Qualquer dificuldade, digite 9". Essa é a mensagem que
  // ENSINA o 9, então ela não pode ser lida como "perguntou um número".
  // Só as PERGUNTAS dela contam: "Boa tarde!" na saudação não é pergunta de período. E a
  // abertura ("Qualquer dificuldade, digite 9") é afirmação, não pergunta, então fica fora.
  const perguntas = textoDoTurno(ultimaDaCarla && ultimaDaCarla.content)
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((frase) => frase.includes("?"));
  if (perguntas.some((frase) => PERGUNTOU_QUANDO.test(frase))) return false;
  return true;
}

module.exports = { pediuAjuda, MENSAGEM };
