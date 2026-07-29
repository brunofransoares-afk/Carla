// Adapter de persistência em memória.
//
// Serve a três coisas, e nenhuma delas é "porque testar é bonito":
//
//   1. Testar comportamento sem escrever em disco. No servidor, a pasta data/ são os
//      pacientes de verdade; um teste que grava lá é um teste que corrompe produção.
//   2. Ser a persistência do sandbox: cada sessão de teste começa limpa e some depois.
//   3. Provar que a porta é uma porta de verdade. Se o Core só funciona com o adapter de
//      arquivo, então a porta não desacoplou nada, só acrescentou uma camada.
//
// O comportamento aqui não é aproximado: os invariantes da porta valem igual. Reservar
// duas vezes o mesmo horário falha na segunda, e lembrete marcado não volta na fila.

// A grade fixa vem da configuração, que é lógica pura, sem I/O. Só os horários extras
// são estado, e esses ficam em memória.
function agenda() {
  return global.Agenda;
}

function criar({ agendamentos = [], extras = [], contatos = {}, sessoes = {} } = {}) {
  const estado = {
    agendamentos: [...agendamentos],
    extras: [...extras],
    contatos: { ...contatos },
    sessoes: { ...sessoes },
    alertas: [],
    silenciados: new Set(),
    naoPacientes: new Set(),
    bloqueiosDeDia: new Set(),
    bloqueiosDeHorario: new Set(),
  };

  // Os dois tipos de lembrete, com os nomes que o storage-node.js usa de verdade.
  // Descobertos pelo teste de equivalência: eu tinha suposto "dia" e "semana".
  const LEMBRETES = { semanaAntes: false, diaDaConsulta: false };

  function slotDeExtra({ data, hora }) {
    const A = agenda();
    const [ano, mes, dia] = data.split("-").map(Number);
    const d = new Date(ano, mes - 1, dia);
    return {
      id: `extra-${data}-${hora}`,
      date: data,
      time: hora,
      weekday: d.getDay(),
      extra: true,
      label: `${global.CARLA_CONFIG.nomesDiaSemana[d.getDay()]} (${A.toDateLabel(d)}) às ${A.formatHora(hora)}`,
    };
  }

  function todosOsSlots(agora) {
    return [...agenda().gerarSlotsPossiveis(agora), ...estado.extras.map(slotDeExtra)];
  }

  return {
    nome: "persistencia-memoria",
    estado, // exposto de propósito: um teste precisa poder olhar o resultado

    // --- Agenda ---
    lerAgendamentos: () => estado.agendamentos.map((a) => ({ ...a })),

    idsOcupados: (agora = new Date()) => {
      // Ocupado não é só consulta marcada: dia bloqueado e horário bloqueado no painel
      // também saem de circulação. Sem isto, o sandbox ofereceria horário que a Carla
      // de verdade nunca ofereceria.
      const reais = estado.agendamentos.map((a) => a.slotId);
      const porDia = estado.bloqueiosDeDia.size === 0
        ? []
        : todosOsSlots(agora).filter((s) => estado.bloqueiosDeDia.has(s.date)).map((s) => s.id);
      return new Set([...reais, ...porDia, ...estado.bloqueiosDeHorario]);
    },

    reservar: ({ slot, responsavel, crianca, telefone, googleEventId = null }) => {
      // INVARIANTE da porta: o segundo pedido para o mesmo horário precisa falhar.
      if (estado.agendamentos.some((a) => a.slotId === slot.id)) {
        return { ok: false, motivo: "Esse horário já está reservado." };
      }
      // Mesmos nomes de campo do storage-node.js: diaLabel, registradoEm, lembretes
      // com as duas chaves. Um agendamento vindo daqui tem que ser indistinguível de um
      // vindo do arquivo, senão o Core passa a depender de qual adapter está por baixo.
      estado.agendamentos.push({
        slotId: slot.id,
        data: slot.date,
        horario: slot.time,
        diaLabel: slot.label,
        responsavel,
        crianca,
        telefone,
        registradoEm: null,
        lembretes: { ...LEMBRETES },
        googleEventId,
        appAgendamentoId: null,
      });
      return { ok: true };
    },

    cancelarAgendamento: (slotId) => {
      const i = estado.agendamentos.findIndex((a) => a.slotId === slotId);
      if (i === -1) return null;
      return estado.agendamentos.splice(i, 1)[0];
    },

    definirAppAgendamentoId: (slotId, appAgendamentoId) => {
      const a = estado.agendamentos.find((x) => x.slotId === slotId);
      if (a) a.appAgendamentoId = appAgendamentoId;
    },

    // Duas regras que só apareceram ao comparar com o arquivo:
    //   - "semanaAntes" mira a data de daqui a 7 dias, não a de hoje
    //   - só telefone começando com "+" recebe lembrete, o que exclui os agendamentos
    //     lançados à mão pelo painel com telefone de placeholder
    agendamentosProntosParaLembrete: (hojeStr, tipo) => {
      let dataAlvo = hojeStr;
      if (tipo === "semanaAntes") {
        const d = new Date(hojeStr + "T00:00:00");
        d.setDate(d.getDate() + 7);
        dataAlvo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
      return estado.agendamentos
        .filter((a) => typeof a.telefone === "string" && a.telefone.startsWith("+"))
        .filter((a) => a.data === dataAlvo && !(a.lembretes && a.lembretes[tipo]))
        .map((a) => ({ ...a }));
    },

    marcarLembreteEnviado: (slotId, tipo) => {
      const a = estado.agendamentos.find((x) => x.slotId === slotId);
      if (a) a.lembretes = { ...LEMBRETES, ...(a.lembretes || {}), [tipo]: true };
    },

    // --- Grade ---
    slotsPossiveisComExtras: (agora = new Date()) => todosOsSlots(agora),

    extrasDisponiveis: (agora = new Date(), ocupados = new Set(), filtros = {}) =>
      estado.extras
        .map(slotDeExtra)
        .filter((s) => !ocupados.has(s.id))
        .filter((s) => {
          if (filtros.dataPreferida && s.date !== filtros.dataPreferida) return false;
          if (filtros.diaPreferido != null && s.weekday !== filtros.diaPreferido) return false;
          if (filtros.periodo === "manha" && s.time >= "12:00") return false;
          if (filtros.periodo === "tarde" && s.time < "12:00") return false;
          return true;
        })
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),

    // --- Conversa ---
    obterSessao: (telefone) => (estado.sessoes[telefone] ? { ...estado.sessoes[telefone] } : null),
    salvarSessao: (telefone, sessao) => {
      estado.sessoes[telefone] = { ...sessao };
    },

    // --- Contatos ---
    registrarContatoWhatsapp: (telefone, { nomeSalvo, pushName } = {}) => {
      const atual = estado.contatos[telefone] || {};
      estado.contatos[telefone] = {
        ...atual,
        nomeSalvo: nomeSalvo !== undefined ? nomeSalvo : atual.nomeSalvo,
        pushName: pushName !== undefined ? pushName : atual.pushName,
      };
    },

    ehPacienteConhecido: (telefone) => {
      // A marcação manual de NÃO paciente vence a detecção automática, igual em produção.
      if (estado.naoPacientes.has(telefone)) return false;
      const c = estado.contatos[telefone];
      return !!(c && c.nomeSalvo);
    },

    contatoSilenciado: (telefone) => estado.silenciados.has(telefone),

    // --- Alertas ---
    registrarAlertaUrgencia: ({ telefone, mensagem, tipo = "emergencia" }) => {
      // INVARIANTE da porta: gravar alerta nunca levanta erro pra quem chamou.
      try {
        estado.alertas.push({ telefone, mensagem, tipo });
      } catch (_) {
        /* engolido de propósito: uma emergência não pode falhar por causa do registro */
      }
    },

    // --- auxiliares só de teste, fora do contrato das portas ---
    _silenciar: (t) => estado.silenciados.add(t),
    _marcarNaoPaciente: (t) => estado.naoPacientes.add(t),
    _adicionarExtra: (data, hora) => estado.extras.push({ data, hora }),
    _bloquearDia: (data) => estado.bloqueiosDeDia.add(data),
    _bloquearHorario: (slotId) => estado.bloqueiosDeHorario.add(slotId),
  };
}

module.exports = { criar };
