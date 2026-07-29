// As portas do Core.
//
// Uma porta é um contrato: o que o Core precisa que o mundo faça por ele, escrito sem
// nenhuma menção a arquivo, WhatsApp, Google ou Supabase. Quem implementa é um adapter.
//
// Por que isso importa aqui, na prática e não em teoria:
//
//   - trocar arquivo JSON por banco vira escrever um adapter novo, sem tocar no miolo
//   - o sandbox precisa de uma persistência descartável: é só outro adapter
//   - a suíte de regressão precisa ver quais ferramentas a IA chamou; isso passa a ser
//     observável quando a chamada atravessa uma porta
//
// A fronteira NÃO foi inventada: veio de ler quem usa o quê no código que está rodando.
//
//   cerebro-ia.js   →  7 funções   (a conversa)
//   server.js       →  9 funções   (o canal)
//   painel-server.js → 23 funções  (a administração)
//
// O Core é a união das duas primeiras: 15 funções. O painel fica de fora de propósito,
// porque desacoplar a administração não é o que destrava as fases seguintes, e cada
// função a mais no contrato é uma função a mais para todo adapter futuro implementar.

// Cada porta declara os métodos e, para cada um, o que o Core espera de volta.
// A verificação de conformidade (conformidade.js) lê isto, então a declaração é
// executável, não comentário.

const PORTA_AGENDA = {
  nome: "Agenda",
  descricao: "As consultas marcadas. É a fonte da verdade de quem tem horário reservado.",
  metodos: {
    lerAgendamentos: {
      aridade: 0,
      devolve: "lista de agendamentos",
      contrato: "Nunca devolve null. Sem nenhum agendamento, devolve lista vazia.",
    },
    idsOcupados: {
      aridade: 1,
      argumentos: "(agora)",
      devolve: "Set de ids de slot",
      contrato: "Set, não lista: o Core usa .has(). Inclui bloqueios, não só consultas.",
    },
    reservar: {
      aridade: 1,
      argumentos: "({ slot, responsavel, crianca, telefone, googleEventId })",
      devolve: "{ ok, motivo? }",
      contrato:
        "INVARIANTE: reservar duas vezes o mesmo slot precisa falhar na segunda. " +
        "É a última linha de defesa contra duas famílias no mesmo horário.",
    },
    cancelarAgendamento: {
      aridade: 1,
      argumentos: "(slotId)",
      devolve: "o agendamento cancelado, ou null se não existia",
      contrato: "Cancelar algo que não existe devolve null, nunca levanta erro.",
    },
    definirAppAgendamentoId: {
      aridade: 2,
      argumentos: "(slotId, appAgendamentoId)",
      devolve: "nada",
      contrato: "Liga a consulta ao id do prontuário. Falha em silêncio se o slot sumiu.",
    },
    agendamentosProntosParaLembrete: {
      aridade: 2,
      argumentos: "(hojeStr, tipo)",
      devolve: "lista de agendamentos",
      contrato: "Só devolve quem ainda não recebeu lembrete daquele tipo.",
    },
    marcarLembreteEnviado: {
      aridade: 2,
      argumentos: "(slotId, tipo)",
      devolve: "nada",
      contrato:
        "INVARIANTE: depois disto, agendamentosProntosParaLembrete não pode devolver " +
        "o mesmo agendamento de novo. É o que impede mandar o mesmo lembrete duas vezes.",
    },
  },
};

const PORTA_GRADE = {
  nome: "Grade",
  descricao: "Que horários existem, além da grade fixa do consultório.",
  metodos: {
    slotsPossiveisComExtras: {
      aridade: 1,
      argumentos: "(agora)",
      devolve: "lista de slots",
      contrato: "A grade normal mais os horários liberados à mão pelo painel.",
    },
    extrasDisponiveis: {
      aridade: 3,
      argumentos: "(agora, ocupados, filtros)",
      devolve: "lista de slots extras livres",
      contrato: "Nunca devolve horário no passado nem já ocupado.",
    },
  },
};

const PORTA_CONVERSA = {
  nome: "Conversa",
  descricao: "O estado de cada conversa: histórico, se está aguardando humano, o que já foi dito.",
  metodos: {
    obterSessao: {
      aridade: 1,
      argumentos: "(telefone)",
      devolve: "a sessão, ou null se é a primeira mensagem",
      contrato: "null significa primeira conversa. O Core trata isso, não é erro.",
    },
    salvarSessao: {
      aridade: 2,
      argumentos: "(telefone, sessao)",
      devolve: "nada",
      contrato: "Sobrescreve inteiro. O Core é quem decide o que fica no histórico.",
    },
  },
};

const PORTA_CONTATOS = {
  nome: "Contatos",
  descricao: "Quem é quem: se o telefone já é paciente, se está silenciado.",
  metodos: {
    registrarContatoWhatsapp: {
      aridade: 2,
      argumentos: "(telefone, { nomeSalvo, pushName })",
      devolve: "nada",
      contrato: "Idempotente. Registrar o mesmo contato de novo não duplica nada.",
    },
    ehPacienteConhecido: {
      aridade: 1,
      argumentos: "(telefone)",
      devolve: "booleano",
      contrato:
        "Muda como a Carla se apresenta. A marcação manual de NÃO paciente vence " +
        "a detecção automática, sempre.",
    },
    contatoSilenciado: {
      aridade: 1,
      argumentos: "(telefone)",
      devolve: "booleano",
      contrato: "Se true, o Core não responde nada. Vale inclusive sobre emergência? Não: ver Segurança.",
    },
  },
};

const PORTA_ALERTAS = {
  nome: "Alertas",
  descricao: "O que precisa de um humano.",
  metodos: {
    registrarAlertaUrgencia: {
      aridade: 1,
      argumentos: "({ telefone, mensagem, tipo })",
      devolve: "nada",
      contrato:
        "INVARIANTE: gravar o alerta NUNCA pode levantar erro pra quem chamou. " +
        "Uma emergência não pode deixar de ser atendida porque o disco encheu.",
    },
  },
};

const PORTA_CALENDARIO = {
  nome: "Calendario",
  descricao: "A agenda externa do profissional, que tem compromissos que o sistema não conhece.",
  metodos: {
    estaLivre: {
      aridade: 2,
      argumentos: "(inicio, fim)",
      devolve: "true, false, ou null",
      contrato:
        "null significa 'não deu pra checar'. O Core segue com a checagem local e NUNCA " +
        "trava por causa disso. Fail-open é deliberado: calendário fora do ar não pode " +
        "impedir a clínica de agendar.",
    },
    criarEvento: {
      aridade: 1,
      argumentos: "({ inicio, fim, titulo, descricao })",
      devolve: "id do evento, ou null",
      contrato: "Falhar aqui não desfaz a reserva. A reserva local é a fonte da verdade.",
    },
    cancelarEvento: {
      aridade: 1,
      argumentos: "(eventId)",
      devolve: "booleano",
      contrato: "Cancelar evento inexistente devolve false, não levanta erro.",
    },
  },
};

const PORTA_PRONTUARIO = {
  nome: "Prontuario",
  descricao: "Espelhamento no sistema clínico. Opcional: nem toda clínica terá.",
  metodos: {
    enviarAgendamento: {
      aridade: 1,
      argumentos: "(dados)",
      devolve: "id no prontuário, ou null",
      contrato:
        "Fire-and-forget. Prontuário fora do ar não pode impedir agendamento. " +
        "Sem configuração, o adapter fica inerte e devolve null.",
    },
    cancelarAgendamento: {
      aridade: 1,
      argumentos: "(appAgendamentoId)",
      devolve: "booleano",
      contrato: "Mesma regra: falha em silêncio, nunca propaga erro.",
    },
  },
};

const PORTA_CANAL = {
  nome: "Canal",
  descricao: "Por onde a conversa acontece. Hoje WhatsApp via Baileys; no SaaS, a API oficial.",
  metodos: {
    enviarTexto: {
      aridade: 2,
      argumentos: "(telefone, texto)",
      devolve: "promessa",
      contrato: "O Core entrega texto pronto. Quebrar em várias mensagens é do adapter.",
    },
    aoReceber: {
      aridade: 1,
      argumentos: "(callback)",
      devolve: "nada",
      contrato:
        "O callback recebe { telefone, texto, id, tipo }. A deduplicação por id e o " +
        "agrupamento por debounce são do Core, não do adapter: são comportamento, não canal.",
    },
    conectar: { aridade: 0, devolve: "promessa", contrato: "Idempotente." },
  },
};

const PORTA_LLM = {
  nome: "LLM",
  descricao: "O modelo que conduz a conversa.",
  metodos: {
    conversar: {
      aridade: 1,
      argumentos: "({ system, mensagens, ferramentas, aoChamarFerramenta })",
      devolve: "{ texto, ferramentasChamadas }",
      contrato:
        "ferramentasChamadas é a lista do que a IA acionou, com argumentos. É o que hoje " +
        "não existe e por isso deixa parte da suíte de regressão sem como verificar. " +
        "Passa a existir porque a chamada atravessa esta porta.",
    },
  },
};

const PORTAS = {
  Agenda: PORTA_AGENDA,
  Grade: PORTA_GRADE,
  Conversa: PORTA_CONVERSA,
  Contatos: PORTA_CONTATOS,
  Alertas: PORTA_ALERTAS,
  Calendario: PORTA_CALENDARIO,
  Prontuario: PORTA_PRONTUARIO,
  Canal: PORTA_CANAL,
  LLM: PORTA_LLM,
};

// As portas que uma persistência precisa cumprir juntas.
const PORTAS_DE_PERSISTENCIA = ["Agenda", "Grade", "Conversa", "Contatos", "Alertas"];

module.exports = { PORTAS, PORTAS_DE_PERSISTENCIA };
