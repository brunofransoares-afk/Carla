// A palavra SILENCIO é um comando pro sistema, não texto pra família.
//
// O QUE ACONTECEU. Uma representante da Danone escreveu pedindo pra agendar uma visita. A
// Carla respondeu, e a família leu isto:
//
//   Bom dia, Érica! 😊
//
//   Obrigada pelo contato! Vou repassar essa mensagem pro Dr. Bruno.
//
//   SILENCIO
//
// A trava era uma igualdade: só valia se a mensagem INTEIRA fosse a palavra. Resposta de
// verdade com o comando emendado no fim não batia, e ia tudo pro WhatsApp.
//
// POR QUE ELA EMENDOU. Duas regras do prompt se somando, como sempre. A do contato
// comercial mandava responder uma vez e "ficar em silêncio nessa conversa"; a da despedida
// ensinava que ficar em silêncio se faz escrevendo SILENCIO. Ela fez as duas de uma vez.
//
// E nem precisava: quem chama escalar_humano já entra em aguardandoHumano, e o server.js
// para de responder aquela conversa sozinho. O comando ali era supérfluo além de vazado.
//
// A REGRA AGORA. O comando é sempre arrancado do texto antes de sair. Se não sobrar mais
// nada, é silêncio, como era antes. Se sobrar, a família recebe só o que era pra ela. Vale
// o comando em linha própria e emendado no meio da frase.
//
// Só maiúscula. "silêncio" com acento, ou "silencio" minúsculo no meio de uma frase, é
// palavra normal do português e a Carla pode legitimamente escrever ("prefiro o silêncio
// aqui na sala de espera"). O comando ela sempre escreve gritado, porque é assim que o
// prompt pede. A única exceção é a mensagem que é SÓ a palavra: aí qualquer caixa serve,
// porque não existe resposta possível que seja essa única palavra e nada mais.

const SO_O_COMANDO = /^\s*silencio\s*$/i;
const EM_LINHA_PROPRIA = /^[ \t]*SILENCIO[ \t]*$/gm;
const EMENDADO_NA_LINHA = /[ \t]*\bSILENCIO\b[ \t]*/g;

// Devolve:
//   texto     o que deve ir pra família (string vazia quando é pra ficar calada)
//   silencio  true quando não sobrou nada pra mandar
//   vazou     true quando o comando veio junto de uma resposta de verdade — isso é defeito
//             de comportamento, não uso normal, e quem chama registra no log
function lerComandoDeSilencio(respostaTexto) {
  const original = String(respostaTexto == null ? "" : respostaTexto);

  if (SO_O_COMANDO.test(original)) {
    return { texto: "", silencio: true, vazou: false };
  }

  const limpo = original
    .replace(EM_LINHA_PROPRIA, "")
    .replace(EMENDADO_NA_LINHA, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (limpo === original.trim()) {
    return { texto: original, silencio: original.trim() === "", vazou: false };
  }

  return { texto: limpo, silencio: limpo === "", vazou: true };
}

module.exports = { lerComandoDeSilencio };
