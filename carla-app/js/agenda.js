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

  // Um horário só existe se ainda dá tempo de chegar nele. A conta é uma só, aqui, porque
  // ela precisa dar a mesma resposta na grade, nos horários abertos à mão e na reserva.
  function temAntecedencia(dataObj, now) {
    const minutos = (dataObj.getTime() - now.getTime()) / 60000;
    return minutos >= CARLA_CONFIG.antecedenciaMinimaMin;
  }

  // E a GRADE tem uma regra a mais: ela nunca mostra o dia de hoje, nem pra urgência. Isto
  // não vale pros horários abertos à mão no painel, e a diferença é o produto inteiro do
  // encaixe: a grade é o que a Carla oferece sozinha, o extra é o que o Dr. Bruno autorizou.
  function ehDiaOferecivelPelaGrade(dataObj, now) {
    if (!temAntecedencia(dataObj, now)) return false;
    if (!CARLA_CONFIG.grade || !CARLA_CONFIG.grade.nuncaHoje) return true;
    return toDateStr(dataObj) !== toDateStr(now);
  }

  /*
   * A QUANTA OCORRÊNCIA DAQUELE DIA DA SEMANA ESTE DIA CORRESPONDE NO MÊS.
   *
   * Dia 1 a 7 é a primeira quinta (ou segunda, ou sexta) do mês; 8 a 14 é a segunda, e assim
   * por diante. É a conta que a pessoa faz olhando o calendário, e não depende de o mês
   * começar no meio da semana, que é onde "semana do mês" erra.
   */
  function ocorrenciaNoMes(date) {
    return Math.floor((date.getDate() - 1) / 7) + 1;
  }

  /*
   * Os horários que existem NAQUELE dia, já com as exceções de ocorrência aplicadas.
   *
   * Uma exceção não acrescenta horário: ela RESTRINGE um horário que já está na lista do dia
   * a algumas ocorrências do mês. É por isso que ela é escrita como "este horário só nas 2ª e
   * 4ª quintas", e não como "nas 2ª e 4ª quintas também tem isso": se fosse acrescentar, um
   * erro de digitação criaria horário onde não existe atendimento, que é o pior lado pra
   * errar. Restringindo, o pior caso é oferecer menos.
   */
  function horariosDoDia(date) {
    const diaSemana = date.getDay();
    const todos = CARLA_CONFIG.horariosSemanais[diaSemana] || [];
    const excecoes = (CARLA_CONFIG.excecoesPorOcorrencia || []).filter((e) => e.diaSemana === diaSemana);
    if (!excecoes.length) return todos.slice();
    const qual = ocorrenciaNoMes(date);
    return todos.filter((hhmm) => {
      const regra = excecoes.find((e) => (e.horarios || []).includes(hhmm));
      if (!regra) return true;
      return (regra.apenasNasOcorrencias || []).includes(qual);
    });
  }

  // Gera todos os horários de início possíveis dentro do horizonte configurado,
  // a partir das janelas de atendimento de cada dia da semana.
  function gerarSlotsPossiveis(now) {
    const slots = [];
    for (let i = 0; i < CARLA_CONFIG.horizonteDias; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const horarios = horariosDoDia(d);
      const dateStr = toDateStr(d);
      for (const hhmm of horarios) {
        // Não oferece horário que já passou, nem horário que começa antes da antecedência
        // mínima. A conferência é sempre, e não só no dia de hoje: a janela pode atravessar
        // a meia-noite, e um "só hoje" seria um buraco esperando o dia em que atravessar.
        const [hSlot, mSlot] = hhmm.split(":").map(Number);
        if (!ehDiaOferecivelPelaGrade(new Date(d.getFullYear(), d.getMonth(), d.getDate(), hSlot, mSlot), now)) continue;
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
      const horarios = horariosDoDia(d);
      for (let j = 0; j < horarios.length - 1; j++) {
        // SEGUIDOS DE VERDADE, E NÃO SÓ VIZINHOS NA LISTA. Com horários explícitos a lista
        // tem buracos de propósito (10h e depois 14h30), e dois horários com quatro horas de
        // distância não servem pra mãe que veio com dois filhos: ela esperaria a manhã toda.
        // Seguido é o próximo que começa quando o anterior acaba, mais o intervalo.
        const distancia = paraMinutos(horarios[j + 1]) - paraMinutos(horarios[j]);
        if (distancia > CARLA_CONFIG.duracaoConsultaMin + CARLA_CONFIG.intervaloMin) continue;
        const idA = slotId(dateStr, horarios[j]);
        const idB = slotId(dateStr, horarios[j + 1]);
        if (idsOcupados.has(idA) || idsOcupados.has(idB)) continue;
        const [hA, mA] = horarios[j].split(":").map(Number);
        if (!ehDiaOferecivelPelaGrade(new Date(d.getFullYear(), d.getMonth(), d.getDate(), hA, mA), now)) continue;
        const rotular = (hhmm) => `${CARLA_CONFIG.nomesDiaSemana[d.getDay()]} (${toDateLabel(d)}) às ${formatHora(hhmm)}`;
        return [
          { id: idA, date: dateStr, time: horarios[j], weekday: d.getDay(), label: rotular(horarios[j]) },
          { id: idB, date: dateStr, time: horarios[j + 1], weekday: d.getDay(), label: rotular(horarios[j + 1]) },
        ];
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
    const duracao = CARLA_CONFIG.duracaoConsultaMin;
    const inicioNovoMin = paraMinutos(horarioDesejado);

    /*
     * O AJUSTE CABE NO EXPEDIENTE DAQUELE DIA, e o expediente é o que a lista do dia desenha:
     * do primeiro horário ao fim do último. Com janelas isso era uma pergunta sobre blocos;
     * com horários explícitos é uma pergunta sobre os extremos, e o que fica entre eles (o
     * intervalo do almoço, por exemplo) é resolvido pelo conflito com consultas marcadas e
     * pelo teto de 30 minutos do próprio ajuste.
     */
    const horariosDoDiaBase = horariosDoDia(d);
    if (!horariosDoDiaBase.length) {
      return { ok: false, motivo: "Esse dia não tem atendimento." };
    }
    const abre = paraMinutos(horariosDoDiaBase[0]);
    const fecha = paraMinutos(horariosDoDiaBase[horariosDoDiaBase.length - 1]) + duracao;
    if (inicioNovoMin < abre || inicioNovoMin + duracao > fecha) {
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

    // O ajuste de até 30 minutos pode empurrar o horário pra dentro da janela de
    // antecedência (ofereceu 11h30 às 10h45, a família pede 11h). Ajuste não é exceção.
    const [hAjuste, mAjuste] = horarioDesejado.split(":").map(Number);
    const dataAjustada = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hAjuste, mAjuste);
    if (dataAjustada <= now) {
      return { ok: false, motivo: "Esse horário ajustado já passou." };
    }
    if (!temAntecedencia(dataAjustada, now)) {
      return { ok: false, motivo: `Esse horário ajustado começa em menos de ${CARLA_CONFIG.antecedenciaMinimaMin} minutos, e a agenda precisa de pelo menos isso de antecedência. Ofereça o horário original ou outro mais adiante.` };
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

  return { gerarSlotsPossiveis, disponiveis, oferecerSlots, doisSeguidos, ajustarHorario, temAntecedencia, ehDiaOferecivelPelaGrade, horariosDoDia, ocorrenciaNoMes, formatHora, toDateLabel, toDateStr };
})();

// Compatibilidade com Node (require) — ver explicação em config.js.
if (typeof module !== "undefined" && module.exports) {
  global.Agenda = Agenda;
  module.exports = Agenda;
}
