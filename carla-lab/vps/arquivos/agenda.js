// Lógica pura da agenda: gerar horários possíveis e filtrar os já reservados.
// Não sabe nada sobre chat, DOM ou armazenamento — só recebe dados e devolve dados.

const Agenda = (() => {
  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toDateStr(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function toDateLabel(date) {
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
  }

  function formatHora(hhmm) {
    const [h, m] = hhmm.split(":");
    const hora = parseInt(h, 10);
    return m === "00" ? `${hora}h` : `${hora}h${m}`;
  }

  function slotId(dateStr, hhmm) {
    return `${dateStr}T${hhmm}`;
  }

  function paraMinutos(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  function paraHHMM(min) {
    return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  }

  // Dentro de uma janela de atendimento (ex: 08:00-12:00), calcula os horários de início
  // possíveis, sempre com 1h de consulta + 30min de intervalo, sem passar do fim da janela.
  function horariosDaJanela(janela) {
    const duracao = CARLA_CONFIG.duracaoConsultaMin;
    const passo = duracao + CARLA_CONFIG.intervaloMin;
    const fimMin = paraMinutos(janela.fim);
    const horarios = [];
    for (let atual = paraMinutos(janela.inicio); atual + duracao <= fimMin; atual += passo) {
      horarios.push(paraHHMM(atual));
    }
    return horarios;
  }

  // Gera todos os horários de início possíveis dentro do horizonte configurado,
  // a partir das janelas de atendimento de cada dia da semana.
  function gerarSlotsPossiveis(now) {
    const slots = [];
    for (let i = 0; i < CARLA_CONFIG.horizonteDias; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const janelas = CARLA_CONFIG.janelasSemanais[d.getDay()] || [];
      const horarios = janelas.flatMap(horariosDaJanela);
      const dateStr = toDateStr(d);
      for (const hhmm of horarios) {
        if (i === 0) {
          // Não oferece horário que já passou hoje.
          const [h, m] = hhmm.split(":").map(Number);
          const slotDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
          if (slotDate <= now) continue;
        }
        slots.push({
          id: slotId(dateStr, hhmm),
          date: dateStr,
          time: hhmm,
          weekday: d.getDay(),
          dateObj: new Date(d.getFullYear(), d.getMonth(), d.getDate(),
            ...hhmm.split(":").map(Number)),
          label: `${CARLA_CONFIG.nomesDiaSemana[d.getDay()]} (${toDateLabel(d)}) às ${formatHora(hhmm)}`,
        });
      }
    }
    return slots;
  }

  function disponiveis(now, idsOcupados) {
    return gerarSlotsPossiveis(now).filter((s) => !idsOcupados.has(s.id));
  }

  function periodoDoSlot(s) {
    return s.time < "12:00" ? "manha" : "tarde";
  }

  // Hash simples e determinístico (mesmo texto sempre dá o mesmo número), só pra
  // variar a escolha sem depender de aleatoriedade de verdade — dá pra testar igual.
  function hashSimples(texto) {
    let h = 0;
    for (let i = 0; i < texto.length; i++) {
      h = (h * 31 + texto.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  // Escolhe até `count` horários evitando repetir o mesmo dia (e, se possível, o mesmo
  // período) entre as opções — assim a família recebe algo como "segunda de manhã ou
  // terça à tarde" em vez de dois horários no mesmo dia.
  function escolherComDiversidade(lista, count) {
    const escolhidos = [];

    // 1ª passada: dia diferente E período diferente dos já escolhidos.
    for (const s of lista) {
      if (escolhidos.length >= count) break;
      if (escolhidos.some((e) => e.date === s.date)) continue;
      if (escolhidos.some((e) => periodoDoSlot(e) === periodoDoSlot(s))) continue;
      escolhidos.push(s);
    }
    // 2ª passada: aceita repetir período, mas ainda evita repetir o dia.
    if (escolhidos.length < count) {
      for (const s of lista) {
        if (escolhidos.length >= count) break;
        if (escolhidos.includes(s)) continue;
        if (escolhidos.some((e) => e.date === s.date)) continue;
        escolhidos.push(s);
      }
    }
    // 3ª passada: poucas opções mesmo — completa com o que sobrar, poder repetir dia.
    if (escolhidos.length < count) {
      for (const s of lista) {
        if (escolhidos.length >= count) break;
        if (escolhidos.includes(s)) continue;
        escolhidos.push(s);
      }
    }
    return escolhidos;
  }

  // Escolhe até `count` horários. Se a família pediu um dia/período/data específico, prioriza
  // esse pedido. Sem pedido específico (caso "rotina"), prioriza dias que JÁ têm outra consulta
  // marcada — concentra as idas do Dr. Bruno ao consultório em menos dias possível — e, dentro
  // disso, sempre o horário mais próximo disponível; nunca pula pra datas distantes só porque
  // um padrão fixo de dia/período está cheio.
  function oferecerSlots(now, idsOcupados, { diaPreferido = null, periodo = null, dataPreferida = null, excluirIds = null, excluirDatas = null, count = 2 } = {}) {
    let livres = disponiveis(now, idsOcupados);
    if (excluirIds && excluirIds.size > 0) livres = livres.filter((s) => !excluirIds.has(s.id));
    if (excluirDatas && excluirDatas.size > 0) livres = livres.filter((s) => !excluirDatas.has(s.date));
    const pediuAlgo = diaPreferido !== null || periodo !== null || dataPreferida !== null;

    if (pediuAlgo) {
      const bate = (s) => {
        if (dataPreferida !== null && s.date !== dataPreferida) return false;
        if (diaPreferido !== null && s.weekday !== diaPreferido) return false;
        if (periodo === "manha" && s.time >= "12:00") return false;
        if (periodo === "tarde" && s.time < "12:00") return false;
        return true;
      };
      const preferidos = livres.filter(bate);
      const resto = livres.filter((s) => !preferidos.includes(s));
      return escolherComDiversidade([...preferidos, ...resto], count);
    }

    // Sem pedido específico: dias com pelo menos uma consulta já marcada vêm primeiro
    // (concentra visitas), e dentro de cada grupo a ordem já é cronológica (mais perto primeiro).
    const diasComReserva = new Set([...idsOcupados].map((id) => id.split("T")[0]));
    const comReserva = livres.filter((s) => diasComReserva.has(s.date));
    const semReserva = livres.filter((s) => !diasComReserva.has(s.date));
    return escolherComDiversidade([...comReserva, ...semReserva], count);
  }

  // Acha os dois primeiros horários que são realmente seguidos (mesma janela de
  // atendimento, um logo depois do outro) — útil quando duas crianças da mesma família
  // (ex: irmãos) precisam ser atendidas em sequência. Diferente de oferecerSlots, aqui os
  // dois horários vêm sempre do mesmo dia e do mesmo período, nunca espalhados.
  function doisSeguidos(now, idsOcupados) {
    for (let i = 0; i < CARLA_CONFIG.horizonteDias; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const dateStr = toDateStr(d);
      const janelas = CARLA_CONFIG.janelasSemanais[d.getDay()] || [];
      for (const janela of janelas) {
        const horarios = horariosDaJanela(janela);
        for (let j = 0; j < horarios.length - 1; j++) {
          const idA = slotId(dateStr, horarios[j]);
          const idB = slotId(dateStr, horarios[j + 1]);
          if (idsOcupados.has(idA) || idsOcupados.has(idB)) continue;
          if (i === 0) {
            const [hA, mA] = horarios[j].split(":").map(Number);
            const dataA = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hA, mA);
            if (dataA <= now) continue;
          }
          const rotular = (hhmm) => `${CARLA_CONFIG.nomesDiaSemana[d.getDay()]} (${toDateLabel(d)}) às ${formatHora(hhmm)}`;
          return [
            { id: idA, date: dateStr, time: horarios[j], weekday: d.getDay(), label: rotular(horarios[j]) },
            { id: idB, date: dateStr, time: horarios[j + 1], weekday: d.getDay(), label: rotular(horarios[j + 1]) },
          ];
        }
      }
    }
    return null;
  }

  // Ajusta um horário já oferecido em até 30 minutos pra atender um pedido específico da
  // família (ex: ofereceu 8h, pediram 8h30). Só aceita se o novo horário continuar dentro
  // do período de atendimento do dia E não ficar perto demais de outra consulta já marcada
  // (usa os agendamentos reais, não só a grade — o intervalo mínimo de 30min é preservado).
  function ajustarHorario(now, slotBase, horarioDesejado, agendamentosExistentes) {
    const diffMin = Math.abs(paraMinutos(horarioDesejado) - paraMinutos(slotBase.time));
    if (diffMin === 0) return { ok: true, slot: slotBase };
    if (diffMin > 30) {
      return { ok: false, motivo: "O ajuste pedido passa de 30 minutos do horário original — não é permitido." };
    }

    const [ano, mes, dia] = slotBase.date.split("-").map(Number);
    const d = new Date(ano, mes - 1, dia);
    const janelas = CARLA_CONFIG.janelasSemanais[slotBase.weekday] || [];
    const duracao = CARLA_CONFIG.duracaoConsultaMin;
    const inicioNovoMin = paraMinutos(horarioDesejado);

    const dentroDeAlgumaJanela = janelas.some(
      (j) => inicioNovoMin >= paraMinutos(j.inicio) && inicioNovoMin + duracao <= paraMinutos(j.fim)
    );
    if (!dentroDeAlgumaJanela) {
      return { ok: false, motivo: "Esse horário ajustado ficaria fora do período de atendimento desse dia." };
    }

    const doMesmoDia = agendamentosExistentes.filter((a) => a.data === slotBase.date && a.horario);
    const conflito = doMesmoDia.some((a) => {
      const inicioExistente = paraMinutos(a.horario);
      return Math.abs(inicioExistente - inicioNovoMin) < duracao + CARLA_CONFIG.intervaloMin;
    });
    if (conflito) {
      return { ok: false, motivo: "Esse horário ajustado ficaria muito próximo de outra consulta já marcada nesse dia." };
    }

    if (toDateStr(now) === slotBase.date) {
      const [h, m] = horarioDesejado.split(":").map(Number);
      const dataAjustada = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
      if (dataAjustada <= now) {
        return { ok: false, motivo: "Esse horário ajustado já passou." };
      }
    }

    return {
      ok: true,
      slot: {
        id: slotId(slotBase.date, horarioDesejado),
        date: slotBase.date,
        time: horarioDesejado,
        weekday: slotBase.weekday,
        label: `${CARLA_CONFIG.nomesDiaSemana[slotBase.weekday]} (${toDateLabel(d)}) às ${formatHora(horarioDesejado)}`,
      },
    };
  }

  return { gerarSlotsPossiveis, disponiveis, oferecerSlots, doisSeguidos, ajustarHorario, formatHora, toDateLabel, toDateStr };
})();

// Compatibilidade com Node (require) — ver explicação em config.js.
if (typeof module !== "undefined" && module.exports) {
  global.Agenda = Agenda;
  module.exports = Agenda;
}
