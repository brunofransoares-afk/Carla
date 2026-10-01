"use strict";

// Fonte única da grade do consultório. Regras de conversa, emergência, preço e pagamento
// não moram aqui: cada uma tem um módulo determinístico próprio no bot. Este arquivo veio
// para dentro do repositório justamente para a disponibilidade da agenda nunca depender de
// uma pasta solta na VPS.
const CARLA_CONFIG = {
  valorConsulta: 550,
  endereco: "Rua Ranulpho Alvarenga Ferreira, 61",
  clinica: "Clínica Rueda",
  pix: "brunofransoares@gmail.com",

  /*
   * OS HORÁRIOS DO CONSULTÓRIO, um por um (2026-10-01).
   *
   * Antes isto eram JANELAS ("das 8 às 12") e os horários saíam de uma conta: duração mais
   * intervalo, do começo ao fim da janela. A grade nova do Dr. Bruno não cabe nisso: ela tem
   * buracos de propósito (10h e depois 14h30, sem nada no meio) e horas que não caem em
   * nenhum passo regular. Horário de consultório é escolha, não progressão aritmética, então
   * agora cada dia tem a LISTA do que existe nele.
   *
   * 0=domingo ... 6=sábado. Sábado e domingo continuam vazios: fim de semana não tem horário
   * fixo aberto, é atendimento de urgência com valor diferenciado e passa por ele (ver
   * ATENDIMENTO DE FIM DE SEMANA, no prompt).
   */
  horariosSemanais: {
    1: ["10:00", "14:30", "16:30"],
    2: ["10:00", "14:30"],
    3: [],
    4: ["08:00", "10:00", "14:30", "16:30"],
    5: ["10:00", "14:30", "16:30", "18:00"],
    6: [],
    0: [],
  },

  /*
   * OS HORÁRIOS QUE SÓ EXISTEM EM ALGUMAS SEMANAS DO MÊS.
   *
   * O dono: o 16h30 da quinta só nas SEGUNDAS E QUARTAS quintas do mês; e na sexta, a tarde
   * inteira (14h30, 16h30 e 18h) só nas PRIMEIRAS, TERCEIRAS E QUINTAS sextas.
   *
   * A ocorrência é contada pelo dia do mês, não por semana do calendário: a primeira
   * quinta-feira do mês é a ocorrência 1, a seguinte é a 2, e assim por diante. É a mesma
   * conta que a pessoa faz olhando o calendário, e não depende de o mês começar no meio da
   * semana.
   */
  excecoesPorOcorrencia: [
    { diaSemana: 4, horarios: ["16:30"], apenasNasOcorrencias: [2, 4] },
    { diaSemana: 5, horarios: ["14:30", "16:30", "18:00"], apenasNasOcorrencias: [1, 3, 5] },
  ],

  /*
   * A PREFERÊNCIA PADRÃO do consultório: com que horários a Carla começa a oferecer quando a
   * família não pediu nada. Segunda de manhã e terça à tarde continuam sendo a escolha dele.
   * Com a grade nova, "manhã" na segunda é o 10h, e "tarde" na terça é o 14h30.
   */
  preferenciaPadrao: (slot) =>
    (slot.weekday === 1 && slot.time < "12:00") ||
    (slot.weekday === 2 && slot.time >= "12:00"),

  nomesDiaSemana: [
    "domingo", "segunda-feira", "terça-feira", "quarta-feira",
    "quinta-feira", "sexta-feira", "sábado",
  ],
  duracaoConsultaMin: 60,

  /*
   * ANTECEDÊNCIA MÍNIMA PRA MARCAR (2026-09-25). O dono: "se eu tenho um horario as 11h em
   * aberto, e ja for 10h, ela nao pode marcar... as vezes eu nem to no consultorio e sao 10 e
   * 50 e ela marca pra 11".
   *
   * Até aqui a única trava era o horário não ter COMEÇADO: às 10h50 um horário de 11h ainda
   * era oferecível e reservável. Só que quem marca uma consulta precisa sair de casa, e quem
   * atende precisa estar lá. Um horário que começa em dez minutos não é horário livre, é um
   * horário que ninguém consegue cumprir.
   *
   * Vale pra grade e pros horários abertos à mão no painel, e vale DUAS vezes: na hora de
   * oferecer e na hora de reservar. São momentos diferentes, e a conversa acontece no meio.
   * Um pedido dentro da janela não é recusa seca: é caso de escalar_humano, e quem decide
   * abrir uma exceção é o Dr. Bruno.
   */
  antecedenciaMinimaMin: 60,

  /*
   * A GRADE NUNCA OFERECE HOJE (2026-10-01). O dono: "eu vou pedir para você parar de
   * oferecer datas do dia de hoje. Nunca ofereça datas do dia atual. Passe a oferecer sempre
   * da próxima semana. Ou dos próximos dias ali." E vale pra urgência também.
   *
   * É mais forte do que a antecedência mínima e NÃO a substitui: as duas valem em lugares
   * diferentes. A grade fixa nunca mostra hoje; o horário que o Dr. Bruno abre NA MÃO pelo
   * painel pode ser hoje, e aí só a antecedência mínima se aplica. Essa diferença é o
   * encaixe: quando ele autoriza, o horário existe e a Carla marca normalmente.
   */
  grade: { nuncaHoje: true },
  intervaloMin: 30,
  horizonteDias: 30,
};

Object.assign(global, { CARLA_CONFIG });
module.exports = { CARLA_CONFIG };
