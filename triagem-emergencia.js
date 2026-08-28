"use strict";

const DIACRITICOS = /[\u0300-\u036f]/g;

function normalizar(texto) {
  return String(texto || "").toLowerCase().normalize("NFD").replace(DIACRITICOS, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// Esta camada só contém descrições objetivas de perigo. Ela não diagnostica: se a própria
// família relata um destes sinais, a orientação segura é procurar atendimento imediato.
const PADROES_IMEDIATOS = [
  { termo: "não consegue respirar", re: /\bnao (?:consegue|conseguia|conseguiu) respirar\b/ },
  { termo: "não está respirando", re: /\b(?:nao (?:esta|ta) respirando|parou de respirar|sem respirar|pausa respiratoria)\b/ },
  { termo: "dificuldade para respirar", re: /\b(?:muita |grande |forte )?dificuldade (?:para|pra|de|em) respirar\b/ },
  { termo: "convulsão", re: /\b(?:convulsionando|convulsao|convulsoes|crise convulsiva)\b/ },
  { termo: "inconsciente", re: /\b(?:desacordad[ao]|inconsciente|perdeu a consciencia|desmaiou)\b/ },
  { termo: "não acorda", re: /\b(?:nao (?:acorda|esta acordando|consigo acordar)|dificil de acordar|nao responde|sem reacao)\b/ },
  {
    termo: "lábios arroxeados",
    re: /\b(?:labio|labios|boca|rosto)\s+(?:(?:ficou|ficaram|esta|estao|ta|tao)\s+)?(?:roxo|roxos|roxa|roxas|arroxeado|arroxeados|arroxeada|arroxeadas|azul|azuis)\b/,
  },
  { termo: "engasgo sem respirar", re: /\b(?:engasgad[ao]|engasgou)\b.{0,28}\b(?:nao (?:respira|consegue respirar|chora)|sem respirar)\b/ },
  { termo: "sangramento que não para", re: /\b(?:sangrando sem parar|nao para de sangrar|muito sangue|perdendo muito sangue)\b/ },
];

// Esta camada contém descrições que podem ser graves, mas também podem ter outro sentido.
// Aqui a Carla pergunta algo objetivo antes de concluir. Assim "o cocô está mole" não vira
// emergência, e uma criança realmente prostrada também não é ignorada.
const PADROES_AMBIGUOS = [
  { termo: "muito mole", re: /\b(?:muito mole|esta mole|ta mole|molinho|molinha)\b/, contexto: "mole" },
  { termo: "muito sonolento", re: /\b(?:muito sonolent[ao]|sonolencia fora do normal|dormindo demais)\b/ },
  { termo: "respiração rápida", re: /\b(?:respiracao (?:muito )?rapid[ao]|respirando (?:muito )?rapid[ao]|respiracao ofegante|ofegante)\b/ },
  { termo: "febre muito alta", re: /\b(?:febre muito alta|febre altissima|(?:40|41)(?: graus)? de febre|febre de (?:40|41))\b/ },
  { termo: "não consegue ingerir líquidos", re: /\b(?:vomita tudo|nao consegue (?:mamar|beber|tomar liquido|tomar agua))\b/ },
];

// Mantidos como listas públicas por compatibilidade com diagnósticos e testes antigos.
const SINAIS_IMEDIATOS = PADROES_IMEDIATOS.map((p) => p.termo);
const SINAIS_AMBIGUOS = PADROES_AMBIGUOS.map((p) => p.termo);

function trechoEstaNegado(texto, inicio, trechoEncontrado) {
  // Expressões que já começam com "não" descrevem o perigo, não negação externa.
  if (/^nao\b/.test(trechoEncontrado)) return false;
  const antes = texto.slice(Math.max(0, inicio - 55), inicio);
  return /(?:^|\s)(?:nao|nunca)\s+(?:(?:esta|ta|ficou|ficaram|teve|tem|apresenta|apresentou)\s+)?(?:(?:mais|com)\s+){0,2}(?:(?:o|a|os|as)\s+)?$/.test(antes)
    || /(?:^|\s)sem\s+(?:(?:o|a|os|as)\s+)?$/.test(antes);
}

function acharPadrao(texto, padroes) {
  for (const padrao of padroes) {
    const achado = padrao.re.exec(texto);
    if (!achado) continue;
    if (trechoEstaNegado(texto, achado.index, achado[0])) continue;

    if (padrao.contexto === "mole") {
      const contexto = texto.slice(Math.max(0, achado.index - 35), achado.index + achado[0].length + 20);
      if (/\b(coco|fezes|diarreia|intestino|evacuacao)\b/.test(contexto)) continue;
    }
    return padrao;
  }
  return null;
}

function avaliar(textoOriginal) {
  const texto = normalizar(textoOriginal);
  if (!texto) return { nivel: "nenhum", termo: null, categoria: null };

  const imediato = acharPadrao(texto, PADROES_IMEDIATOS);
  if (imediato) return { nivel: "emergencia", termo: imediato.termo, categoria: "sinal_objetivo" };

  const ambiguo = acharPadrao(texto, PADROES_AMBIGUOS);
  if (ambiguo) return { nivel: "confirmar", termo: ambiguo.termo, categoria: "sinal_ambiguo" };

  return { nivel: "nenhum", termo: null, categoria: null };
}

function respostaDeConfirmacao() {
  return "Quero confirmar uma coisa importante: a criança está muito sonolenta ou difícil de acordar, com dificuldade para respirar, convulsionando ou com os lábios arroxeados?\n\nSe sim, procure atendimento de emergência agora. Se não conseguir levá-la, ligue 192 (SAMU).";
}

function respostaDeEmergencia() {
  return "Isso é um sinal de perigo e precisa de atendimento imediato.\n\nLeve a criança agora ao pronto-socorro mais próximo. Se não conseguir levá-la, ligue 192 (SAMU).\n\nVou avisar o Dr. Bruno sobre esse contato.";
}

function respostaConfirmaPerigo(textoOriginal) {
  const texto = normalizar(textoOriginal);
  if (!texto || /\b(?:nao|negativo|melhorou|passou)\b/.test(texto)) return false;
  return /^(?:sim|isso|esta|ta|continua|com certeza)(?:\s|$)/.test(texto);
}

module.exports = {
  avaliar,
  normalizar,
  respostaDeConfirmacao,
  respostaDeEmergencia,
  respostaConfirmaPerigo,
  SINAIS_IMEDIATOS,
  SINAIS_AMBIGUOS,
};
