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

  // 0=domingo ... 6=sábado. Uma consulta dura 1h e há 30min entre inícios.
  janelasSemanais: {
    1: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "16:30" }],
    2: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "15:00" }],
    3: [],
    4: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "16:00" }],
    5: [{ inicio: "08:00", fim: "12:00" }],
    6: [],
    0: [],
  },

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
  intervaloMin: 30,
  horizonteDias: 30,
};

Object.assign(global, { CARLA_CONFIG });
module.exports = { CARLA_CONFIG };
