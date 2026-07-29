// Configuração fixa da Carla: horários, valores, textos institucionais.
// Nada aqui depende de DOM ou de armazenamento — só dados.

const CARLA_CONFIG = {
  valorConsulta: 550,
  endereco: "Rua Ranulpho Alvarenga Ferreira, 61",
  clinica: "Clínica Rueda",
  pix: "brunofransoares@gmail.com",

  // Chave = dia da semana no padrão JS (0=domingo ... 6=sábado).
  // Cada dia tem uma ou mais janelas de atendimento; os horários de início dentro
  // de cada janela são calculados automaticamente (agenda.js) respeitando 1h de
  // consulta + 30min de intervalo, sem nunca ultrapassar o fim da janela.
  janelasSemanais: {
    1: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "16:30" }], // segunda
    2: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "15:00" }], // terça
    3: [],                                                                     // quarta - sem atendimento
    4: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "16:00" }], // quinta
    5: [{ inicio: "08:00", fim: "12:00" }],                                    // sexta
    6: [],
    0: [],
  },

  // Ao oferecer horários, quando a família não pedir um dia/período específico,
  // dar preferência a estes: segunda de manhã e terça à tarde.
  preferenciaPadrao: (slot) =>
    (slot.weekday === 1 && slot.time < "12:00") ||
    (slot.weekday === 2 && slot.time >= "12:00"),

  nomesDiaSemana: [
    "domingo", "segunda-feira", "terça-feira", "quarta-feira",
    "quinta-feira", "sexta-feira", "sábado",
  ],

  duracaoConsultaMin: 60,
  intervaloMin: 30,

  horizonteDias: 30, // quantos dias pra frente a agenda enxerga
};

// Palavras-chave de emergência: sempre checadas primeiro, acima de qualquer outra coisa.
const EMERGENCIA_PALAVRAS = [
  "falta de ar", "dificuldade para respirar", "dificuldade de respirar",
  "nao consegue respirar", "parou de respirar", "respiracao ofegante", "convulsao",
  "convulsionando", "convulsionou", "crise convulsiva", "desmaiou", "desmaiando",
  "desacordado", "desacordada", "nao acorda", "nao esta acordando", "nao consigo acordar",
  "muito mole", "sem reacao", "sem forca nenhuma", "labio roxo", "ficou roxo", "ficou roxa",
  "roxinho", "roxinha", "cianose", "engasgado e nao chora", "engasgada e nao chora",
  "engasgo grave", "febre muito alta", "febre altissima", "febre de 40", "febre 40",
  "sangramento muito", "batendo a cabeca muito forte", "caiu e bateu a cabeca forte",
  "sangrando muito", "sangrando sem parar", "nao para de sangrar", "muito sangue",
  "perdendo muito sangue", "sangrou muito", "bateu a cabeca forte",
  "bateu a cabeca muito forte", "bateu a cabeca com forca", "caiu de cabeca",
  "bateu a cabeca e vomitou", "bateu a cabeca e desmaiou", "desmaio", "engasgando",
  "esta engasgado", "esta engasgada", "engasgou e nao consegue", "40 de febre", "41 de febre",
  "febre de 41", "febre 41", "nao esta respirando", "respiracao rapida", "ofegante",
  "esta roxo", "esta roxa", "ta roxo", "ta roxa", "ta engasgado", "ta engasgada", "esta mole",
  "ta mole",
];

const SAUDACAO_REGEX = /^(oi+|ol[aá]|bom\s*dia|boa\s*tarde|boa\s*noite|opa|e\s*a[íi])[\s!.,?]*$/i;

const PALAVRAS = {
  agendar: [
    "marcar", "agendar", "reservar", "remarcar", "encaixar", "bater um horario",
    "tem horario", "tem vaga", "que horas", "quero horario",
    // formas mais soltas de pedir consulta, tipo "consulta pro meu filho" ou "preciso de uma consulta"
    "\\b(quero|queria|preciso|precisava|gostaria)\\b[\\s\\S]{0,25}\\bconsulta",
    "\\bconsulta\\b[\\s\\S]{0,25}\\b(pro|pra|para|meu|minha|meus|minhas)\\b[\\s\\S]{0,15}\\b(filho|filha|bebe|crianca|nenem)",
    "\\b(meu|minha)\\b[\\s\\S]{0,15}\\b(filho|filha|bebe|crianca|nenem)\\b[\\s\\S]{0,25}\\bconsulta",
    // "tem pra hoje?", "consegue encaixar amanhã?" e afins
    "\\b(hoje|amanha)\\b[\\s\\S]{0,20}\\b(tem|vaga|horario|encaixa|consegue|da pra|de repente)\\b",
    "\\b(tem|vaga|horario|encaixa|consegue|da pra)\\b[\\s\\S]{0,20}\\b(hoje|amanha)\\b",
  ],
  convenio: ["convenio", "plano de saude", "unimed", "bradesco saude", "sulamerica", "amil", "notredame", "hapvida"],
  teleconsulta: ["teleconsulta", "tele consulta", "por video", "videochamada", "video chamada", "online", "a distancia"],
  retorno: ["retorno", "reconsulta", "consulta de retorno"],
  pagamento: ["\\bforma?s?\\s+de\\s+pagamento\\b", "como pago", "como faco o pagamento", "pix", "cartao", "parcela", "parcelado", "dinheiro"],
  desenvolvimento: ["autismo", "\\btea\\b", "tdah", "atraso no desenvolvimento", "atraso de fala", "nao fala", "desenvolvimento", "comportamento", "aprendizagem", "hiperativo", "hiperatividade"],
  rotina: ["rotina", "acompanhamento", "puericultura", "check-up", "checape", "check up", "consulta de rotina", "recem nascido", "recem-nascido", "primeira consulta"],
  agudo: ["febre", "tosse", "dor de ouvido", "dor de barriga", "dor de garganta", "vomito", "diarreia", "gripe", "resfriado", "alergia", "mancha na pele", "passando mal", "ta doente", "esta doente"],
  preco: ["valor", "preco", "quanto custa", "quanto e", "quanto fica", "quanto sai", "quanto cobra"],
  notaFiscal: ["nota fiscal", "preciso de nota", "emite nota", "emitem nota", "emissao de nota", "recibo", "reembolso"],
};

// Palavras "âncora" de cada categoria, usadas na checagem tolerante a erro de digitação
// (distância de edição pequena). Fica de fora dali o que só faz sentido como frase inteira.
const PALAVRAS_FUZZY = {
  agendar: ["marcar", "agendar", "reservar", "encaixar"],
  convenio: ["convenio", "unimed", "amil"],
  teleconsulta: ["teleconsulta", "videochamada"],
  retorno: ["retorno"],
  pagamento: ["pix", "cartao", "dinheiro"],
  desenvolvimento: ["autismo", "tdah", "desenvolvimento", "comportamento"],
  rotina: ["rotina", "puericultura", "acompanhamento"],
  agudo: ["febre", "tosse", "vomito", "diarreia", "gripe", "resfriado", "alergia"],
  preco: ["valor"],
};

// Respostas curtas que, logo depois de uma pergunta-convite da Carla (ex: "Vamos agendar um horário?"),
// devem ser entendidas como "sim, quero agendar" — sem precisar repetir a palavra "marcar".
const AFIRMATIVO_REGEX = /^(sim+|isso|quero( sim)?|pode ser|vamos( marcar)?|bora|ok(ay)?|claro|com certeza|aceito|show|perfeito|beleza|fechado|manda|pod(e|emos))[\s!.,]*$/i;

// Pedido de outra opção ou qualquer recusa, sem dizer qual dia/período específico
// ("outro dia?", "não dá nenhum desses", "tem mais opção?", "não consigo", "não vai dar").
const OUTRA_OPCAO_REGEX = /\b(outro dia|outro horario|outra op[cç]ao|outras op[cç]oes|mais op[cç]oes|nenhum(a)? dess[ea]s?)\b|\bnao (da|consigo|posso|vai dar)\b/i;

// Objeção de preço: a pessoa já sabe o valor e está reclamando/hesitando por causa dele
// (diferente de simplesmente perguntar quanto custa, que cai em PALAVRAS.preco).
const OBJECAO_PRECO_REGEX = /\b(caro|cara)\b|\bsalgad[oa]\b|\bpesad[oa]\s+(pro|para o)\s+bolso\b|nao\s+tenho\s+(como|condi[cç][aã]o|condi[cç][oõ]es)\s+(de\s+)?pagar|nao\s+posso\s+pagar|\b(mto|muito)\s+alto\b|fora\s+do\s+(meu\s+)?or[cç]amento/i;

// Despedida/agradecimento: sinal de que a pessoa está fechando a conversa por agora
// (não precisa ser a mensagem inteira, ex: "não precisa, obrigado" ou "NAO PRECISA OBRIGADO").
const DESPEDIDA_REGEX = /\bobrigad[ao]s?\b|\bobg\b|\bvlw\b|\bvaleu\b|\bbrigad[ao]o?\b|\bagradec\w*\b|\bdeixa\s+pra\s+l[aá]\b|\btchau\b|\bflw\b|\bate\s+mais\b|\bde\s+boa\b/i;

// Recusa explícita a agendar (diferente de "outro dia"/"nenhum desses" durante a oferta de
// horário — aqui a pessoa está desistindo do agendamento como um todo, não pedindo outra opção).
const RECUSA_AGENDAR_REGEX = /nao\s+(vou|vo|quero|queria|preciso|precisava)\s+(mais\s+)?(agendar|marcar)|desist[oi]|mudei\s+de\s+ideia|\bnao\s+quero\s+mais\b/i;

const DIA_PALAVRAS = {
  1: ["segunda"],
  2: ["terca", "terça"],
  3: ["quarta"],
  4: ["quinta"],
  5: ["sexta"],
};

// Sinais de que a criança já teve idade ou motivo mencionados em algum ponto da conversa,
// pra Carla não perguntar de novo o que já foi dito.
const IDADE_PALAVRAS_REGEX = /\b\d{1,2}\s*(ano|anos|mes|meses)\b|recem[\s-]nascid[ao]|\bbebe\b/i;

// Palavrões e ofensas comuns: quando aparecem, a Carla ignora o teor e reconduz a conversa.
const OFENSA_PALAVRAS = [
  "porra", "merda", "caralho", "fdp", "foda-se", "desgraca", "idiota", "imbecil",
  "estupido", "estupida", "burro", "burra", "vagabundo", "vagabunda", "otario",
  "otaria", "babaca", "inutil", "cuzao", "arrombado", "desgracado", "desgracada",
];

// Palavras que indicam que a mensagem provavelmente é sobre o consultório/família,
// mesmo quando nenhuma outra categoria bateu (ajuda a distinguir "vago" de "fora do assunto").
const PALAVRAS_RELACIONADAS = [
  "filho", "filha", "filhinho", "filhinha", "bebe", "crianca", "nenem",
  "recem nascido", "pediatra", "doutor bruno", "dr bruno", "medico", "consulta",
  "saude", "doente", "hospital", "pronto socorro", "exame", "vacina",
];

// Versão tolerante a erro de digitação das palavras mais comuns dessa lista
// (ex: "clnsulta" ainda devia contar como "consulta").
const PALAVRAS_RELACIONADAS_FUZZY = ["consulta", "pediatra", "medico", "hospital", "vacina"];

// Compatibilidade com Node (require): no navegador, esse bloco não faz nada,
// pois "module" não existe. É o que permite o mesmo arquivo alimentar tanto
// a tela de teste quanto o bot de WhatsApp, sem duplicar nenhuma regra.
if (typeof module !== "undefined" && module.exports) {
  const exportado = {
    CARLA_CONFIG, EMERGENCIA_PALAVRAS, SAUDACAO_REGEX,
    PALAVRAS, PALAVRAS_FUZZY, AFIRMATIVO_REGEX, OUTRA_OPCAO_REGEX, DIA_PALAVRAS,
    IDADE_PALAVRAS_REGEX, OFENSA_PALAVRAS, PALAVRAS_RELACIONADAS, PALAVRAS_RELACIONADAS_FUZZY,
    OBJECAO_PRECO_REGEX, DESPEDIDA_REGEX, RECUSA_AGENDAR_REGEX,
  };
  Object.assign(global, exportado);
  module.exports = exportado;
}
