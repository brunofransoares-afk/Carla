// Lista proposta de palavras de emergência.
//
// Mantém TODAS as palavras que já existem hoje (nenhuma é removida) e acrescenta as
// formas que uma mãe realmente usa no WhatsApp e que hoje passam batido.
//
// Regras que guiaram cada acréscimo:
//   - a comparação é `includes` em texto sem acento, então a frase mais curta pega as
//     mais longas: "sangrando muito" pega "está sangrando muito desde agora"
//   - nada de palavra solta que apareça em conversa comum. "engasgou" sozinho pegaria
//     "engasgou com água mas já passou"; por isso só entram as formas de agora
//     ("engasgando", "esta engasgado")
//   - "bateu a cabeca" sozinho pegaria "bateu a cabecinha de leve"; por isso a
//     intensidade faz parte do termo ("bateu a cabeca forte", "com forca")

module.exports = [
  // ---- respiração (já existiam) ----
  "falta de ar", "dificuldade para respirar", "dificuldade de respirar",
  "nao consegue respirar", "parou de respirar", "respiracao ofegante",

  // ---- convulsão (já existiam) ----
  "convulsao", "convulsionando", "convulsionou", "crise convulsiva",

  // ---- consciência (já existiam) ----
  "desmaiou", "desmaiando", "desacordado", "desacordada",
  "nao acorda", "nao esta acordando", "nao consigo acordar",
  "muito mole", "sem reacao", "sem forca nenhuma",

  // ---- cianose (já existiam) ----
  "labio roxo", "ficou roxo", "ficou roxa", "roxinho", "roxinha", "cianose",

  // ---- engasgo (já existiam) ----
  "engasgado e nao chora", "engasgada e nao chora", "engasgo grave",

  // ---- febre (já existiam) ----
  "febre muito alta", "febre altissima", "febre de 40", "febre 40",

  // ---- trauma e sangramento (já existiam) ----
  "sangramento muito", "batendo a cabeca muito forte", "caiu e bateu a cabeca forte",

  // =========================================================================
  // ACRÉSCIMOS: formas que hoje passam batido
  // =========================================================================

  // "sangramento muito" nunca dispara porque ninguém escreve assim.
  "sangrando muito", "sangrando sem parar", "nao para de sangrar",
  "muito sangue", "perdendo muito sangue", "sangrou muito",

  // "batendo a cabeca muito forte" exige o gerúndio exato. A mãe escreve no passado.
  // A intensidade fica dentro do termo pra não pegar "bateu a cabecinha de leve".
  "bateu a cabeca forte", "bateu a cabeca muito forte", "bateu a cabeca com forca",
  "caiu de cabeca", "bateu a cabeca e vomitou", "bateu a cabeca e desmaiou",

  // Só existia o verbo. "teve um desmaio" passava batido.
  "desmaio",

  // Só existiam as formas compostas. Estas são as do momento em que está acontecendo.
  "engasgando", "esta engasgado", "esta engasgada", "engasgou e nao consegue",

  // Só existia "febre de 40" e "febre 40". A ordem inversa é igualmente comum.
  "40 de febre", "41 de febre", "febre de 41", "febre 41",

  // "parou de respirar" e "nao consegue respirar" existiam, mas a forma mais comum de
  // descrever o quadro em andamento, não o extremo, ficava de fora.
  "nao esta respirando", "respiracao rapida", "ofegante",

  // Só existiam "ficou roxo/roxa". A forma no presente é a que a mãe usa na hora.
  // Ressalva assumida: isto também dispara em hematoma ("o joelho esta roxo"). Um
  // alarme falso custa um escalonamento desnecessário; deixar cianose passar custa outra
  // coisa. A lista de hoje já corre esse risco com "ficou roxo".
  "esta roxo", "esta roxa", "ta roxo", "ta roxa",

  // Informal de "esta engasgado". No WhatsApp "tá" é mais frequente que "está".
  "ta engasgado", "ta engasgada",

  // "muito mole" existia, mas a mãe raramente põe o "muito".
  // Ressalva assumida e testada: isto dispara em "o cocô está mole", conversa comum em
  // pediatria. Criança mole é sinal de alarme de verdade; o custo do falso positivo é
  // uma escalação a mais, e foi escolhido conscientemente.
  "esta mole", "ta mole",
];
