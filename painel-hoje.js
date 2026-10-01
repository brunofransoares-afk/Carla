// A tela "Hoje" e os "Números" do painel: o que as funções da Oculoplastic viram na Carla.
//
// Módulo PURO, como o crm.js: recebe listas já lidas e devolve listas e números. Não lê arquivo,
// não fala com o WhatsApp, não chama new Date() (o relógio entra por fora, `agora`). Assim a
// bateria testa com dados inventados, sem SQLite nem rede.
//
// A REGRA QUE VEIO DA OCULOPLASTIC E GOVERNA ESTE ARQUIVO: o que não foi registrado não é zero.
// Sem dado a conta volta com `semDado: true` e a tela escreve "sem dado ainda". Zero afirma que
// ninguém fechou; "sem dado" afirma que não sabemos. São coisas diferentes na hora de decidir.
"use strict";

const path = require("path");
const Preco = require(path.join(__dirname, "preco-da-consulta.js"));

const DIA_MS = 24 * 60 * 60 * 1000;

// Abaixo disto a "pior passagem" do funil é ruído: 1 de 2 famílias é 50% e não quer dizer nada.
const BASE_MINIMA_GARGALO = 3;

// O consultório só segue um lead por um tempo. Passou disto, sai da lista do dia (a lista
// de famílias continua tendo a pessoa, com a situação "Sem resposta").
const FOLLOWUP_LIMITE_DIAS = 60;

const TIPOS_DE_PENDENCIA = [
  { tipo: "responder", rotulo: "Responder", ordem: 1 },
  { tipo: "pagamento", rotulo: "Pagamento pendente", ordem: 2 },
  { tipo: "retorno", rotulo: "Retorno a avisar", ordem: 3 },
  { tipo: "pos_consulta", rotulo: "Pós-consulta", ordem: 4 },
  { tipo: "parou_valor", rotulo: "Parou depois do valor", ordem: 5 },
  { tipo: "followup7", rotulo: "Follow-up de 7 dias", ordem: 6 },
  { tipo: "followup30", rotulo: "Follow-up de 30 dias", ordem: 7 },
];

// ---------------------------------------------------------------- datas

function dataLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

function mesDe(d) {
  return dataLocal(d).slice(0, 7);
}

function mesDoIso(iso) {
  const d = new Date(iso || "");
  return Number.isNaN(d.getTime()) ? null : mesDe(d);
}

function mesAnterior(mes) {
  let [a, m] = mes.split("-").map(Number);
  m -= 1;
  if (m < 1) { m = 12; a -= 1; }
  return `${a}-${String(m).padStart(2, "0")}`;
}

function iniciarSemana(agora) {
  // Segunda-feira 00:00 local.
  const base = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const deslocamento = (base.getDay() + 6) % 7;
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() - deslocamento);
}

function dias(desdeIso, agora) {
  const t = new Date(desdeIso || "").getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((agora.getTime() - t) / DIA_MS);
}

// ---------------------------------------------------------------- funil: passagem e gargalo

// Taxa de passagem de cada etapa para a seguinte, e a pior delas (o gargalo). A Carla já
// mostrava a maior queda em número; a taxa é o que diz onde o funil vaza de verdade, porque
// perder 8 de 100 e perder 8 de 10 não são o mesmo problema.
function passagensDoFunil(etapas) {
  const lista = [];
  const base = Array.isArray(etapas) ? etapas : [];
  for (let i = 1; i < base.length; i++) {
    const de = base[i - 1];
    const para = base[i];
    const baseQt = Number(de.quantidade) || 0;
    const passaram = Math.min(Number(para.quantidade) || 0, baseQt);
    lista.push({
      de: de.rotulo, para: para.rotulo, deChave: de.chave, paraChave: para.chave,
      base: baseQt, passaram, perdeu: baseQt - passaram,
      pct: baseQt > 0 ? Math.round((passaram / baseQt) * 100) : null,
    });
  }
  const candidatas = lista.filter((p) => p.base >= BASE_MINIMA_GARGALO && p.perdeu > 0);
  candidatas.sort((a, b) => (a.pct - b.pct) || (b.perdeu - a.perdeu));
  const gargalo = candidatas[0] || null;
  return {
    passagens: lista.map((p) => ({ ...p, gargalo: !!gargalo && p.deChave === gargalo.deChave })),
    gargalo,
    baseMinima: BASE_MINIMA_GARGALO,
  };
}

// ---------------------------------------------------------------- pendências do dia

// Quando o consultório falou por último com cada telefone: mensagem do Dr. Bruno, retomada
// enviada, ou follow-up registrado na ficha. É a base do "já fiz o follow-up".
function contatosDoConsultorio(eventos, contatos) {
  const mapa = new Map();
  const marcar = (telefone, iso) => {
    const t = new Date(iso || "").getTime();
    if (!telefone || Number.isNaN(t)) return;
    if (!mapa.has(telefone)) mapa.set(telefone, []);
    mapa.get(telefone).push(t);
  };
  for (const e of eventos || []) {
    if (e && (e.tipo === "mensagem_manual" || e.tipo === "reaquecido")) marcar(e.telefone, e.em);
  }
  for (const c of contatos || []) {
    for (const f of c.followups || []) marcar(c.telefone, f.em);
  }
  return mapa;
}

function ehLeadParaFollowup(c) {
  if (!c.ultimaAtividade) return false;
  if (c.ehPaciente || c.proximaConsulta || c.silenciado || c.perda) return false;
  if (c.situacoes.includes("aguardando_humano")) return false;
  if (c.primeiraPergunta === "convenio") return false;
  // Só quem recebeu valor ou horário recebeu uma proposta. Quem mandou só "oi" não tem o que cobrar.
  return ["recebeuPreco", "recebeuHorario", "agendou"].includes(c.estagio && c.estagio.chave);
}

function pendenciasDoDia({ contatos = [], eventos = [], agora = new Date() } = {}) {
  const feitos = contatosDoConsultorio(eventos, contatos);
  const itens = [];
  const nomeDe = (c) => c.nome || c.responsavel || c.telefone;
  const base = (c, tipo) => ({
    id: `${tipo}:${c.telefone}`, tipo, telefone: c.telefone, nome: nomeDe(c),
    rotuloDoTipo: TIPOS_DE_PENDENCIA.find((t) => t.tipo === tipo).rotulo,
    ordem: TIPOS_DE_PENDENCIA.find((t) => t.tipo === tipo).ordem,
    desde: c.ultimaAtividade || null,
  });

  for (const c of contatos) {
    if (c.situacoes.includes("aguardando_humano")) {
      const pausada = c.situacoes.includes("pausada_por_voce");
      itens.push({ ...base(c, "responder"),
        motivo: pausada
          ? "Carla pausada: você escreveu nesta conversa. Ela só volta quando você tocar em Retomar na ficha."
          : "A Carla está quieta, esperando você.",
        trecho: c.ultimaMensagem || "" });
    }
    if (c.situacoes.includes("aguardando_pagamento") && c.proximaConsulta) {
      const k = c.proximaConsulta;
      itens.push({ ...base(c, "pagamento"), motivo: `Reservou e não pagou. Consulta ${k.data.split("-").reverse().slice(0, 2).join("/")} às ${k.horario}${k.crianca ? ` (${k.crianca})` : ""}.`, quando: `${k.data} ${k.horario}`, slotId: k.slotId });
    }
    if (c.situacoes.includes("retorno_proximo") && c.retornoPendente) {
      const r = c.retornoPendente;
      itens.push({ ...base(c, "retorno"), motivo: `Retorno de ${r.meses} meses${r.crianca ? ` de ${r.crianca}` : ""}, ${r.diasFaltando > 0 ? `em ${r.diasFaltando} dia${r.diasFaltando === 1 ? "" : "s"}` : r.diasFaltando === 0 ? "é hoje" : `venceu há ${-r.diasFaltando} dia${r.diasFaltando === -1 ? "" : "s"}`}.`, quando: r.data });
    }
    if (c.posConsulta && c.ultimaConsulta && c.posConsulta.diasDesde >= 1 && c.posConsulta.diasDesde <= 3) {
      const marco = new Date(`${c.ultimaConsulta.data}T00:00:00`).getTime();
      const jaFalou = (feitos.get(c.telefone) || []).some((t) => t >= marco);
      if (!jaFalou) {
        itens.push({ ...base(c, "pos_consulta"), motivo: `Consulta${c.posConsulta.crianca ? ` de ${c.posConsulta.crianca}` : ""} há ${c.posConsulta.diasDesde} dia${c.posConsulta.diasDesde === 1 ? "" : "s"}. Perguntar como está.`, quando: c.ultimaConsulta.data });
      }
    }
    // Soube o valor e sumiu, nos primeiros 7 dias: é a janela quente, antes do follow-up de 7.
    if (c.situacoes.includes("parou_no_preco") && !c.silenciado && !c.perda && c.ultimaAtividade && dias(c.ultimaAtividade, agora) < 7) {
      itens.push({ ...base(c, "parou_valor"), motivo: "Soube o valor e parou de responder." });
    }
    if (ehLeadParaFollowup(c)) {
      const d = dias(c.ultimaAtividade, agora);
      let prazo = null;
      if (d !== null && d >= 7 && d < 30) prazo = 7;
      else if (d !== null && d >= 30 && d <= FOLLOWUP_LIMITE_DIAS) prazo = 30;
      if (prazo) {
        const atividade = new Date(c.ultimaAtividade).getTime();
        const corte = atividade + (prazo - 1) * DIA_MS;
        const feito = (feitos.get(c.telefone) || []).some((t) => t >= corte);
        if (!feito) {
          itens.push({ ...base(c, `followup${prazo}`), prazo, motivo: `${c.estagio.rotulo}, sem resposta há ${d} dias. Follow-up de ${prazo} dias.` });
        }
      }
    }
  }

  // Dentro de cada tipo, o mais antigo primeiro; pagamento e retorno, pela data que vence.
  itens.sort((a, b) => {
    if (a.ordem !== b.ordem) return a.ordem - b.ordem;
    const ka = a.quando || a.desde || "";
    const kb = b.quando || b.desde || "";
    return String(ka).localeCompare(String(kb)) || String(a.nome).localeCompare(String(b.nome));
  });

  const porTipo = {};
  for (const t of TIPOS_DE_PENDENCIA) porTipo[t.tipo] = itens.filter((i) => i.tipo === t.tipo).length;
  return { itens, total: itens.length, porTipo, tipos: TIPOS_DE_PENDENCIA };
}

// ---------------------------------------------------------------- dinheiro

function valorDoAgendamento(a) {
  if (!a || !a.tipoConsulta) return null;
  const p = Preco.precoDaConsulta({ date: a.data }, a.tipoConsulta);
  return p.valido ? p.centavos : null;
}

function reais(centavos) {
  return Preco.reais(centavos);
}

// ---------------------------------------------------------------- mês contra mês e semana

function registrosDe({ contatosFunil = [], agendamentos = [] }) {
  const lista = [];
  for (const c of contatosFunil) if (c.primeiroContatoEm) lista.push(c.primeiroContatoEm);
  for (const a of agendamentos) if (a && a.registradoEm) lista.push(a.registradoEm);
  return lista.filter((iso) => !Number.isNaN(new Date(iso).getTime())).sort();
}

// Os quatro números de um intervalo [de, ate): contatos novos, consultas marcadas, consultas
// pagas e o faturamento recebido. Pago conta no dia em que o Dr. Bruno marcou (pagoEm); sem
// essa data (marcado antes de ela existir) cai no dia da reserva.
function contaIntervalo({ contatosFunil = [], agendamentos = [] }, de, ate) {
  const dentro = (iso) => {
    const t = new Date(iso || "").getTime();
    return !Number.isNaN(t) && t >= de.getTime() && t < ate.getTime();
  };
  const novosContatos = contatosFunil.filter((c) => dentro(c.primeiroContatoEm)).length;
  const marcadas = agendamentos.filter((a) => a && dentro(a.registradoEm)).length;
  const pagas = agendamentos.filter((a) => a && a.estado === "pago" && dentro(a.pagoEm || a.registradoEm));
  let faturamentoCentavos = 0;
  let pagasSemValor = 0;
  for (const a of pagas) {
    const v = valorDoAgendamento(a);
    if (v === null) pagasSemValor++;
    else faturamentoCentavos += v;
  }
  return { novosContatos, consultasMarcadas: marcadas, consultasPagas: pagas.length, faturamentoCentavos, pagasSemValor };
}

function comparacaoMensal(fonte, agora) {
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const inicioProximo = new Date(agora.getFullYear(), agora.getMonth() + 1, 1);
  const inicioAnterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
  const registros = registrosDe(fonte);
  const primeiro = registros[0] ? new Date(registros[0]) : null;
  const atual = contaIntervalo(fonte, inicioMes, inicioProximo);
  // O mês anterior só existe se o registro começou antes do mês atual. Antes disso, "zero"
  // seria mentira: o painel ainda não estava anotando.
  const temAnterior = !!primeiro && primeiro.getTime() < inicioMes.getTime();
  const anterior = temAnterior ? contaIntervalo(fonte, inicioAnterior, inicioMes) : null;
  const anteriorParcial = temAnterior && primeiro.getTime() > inicioAnterior.getTime();
  return {
    mes: mesDe(agora), mesAnterior: mesAnterior(mesDe(agora)),
    semDado: !primeiro,
    atual, anterior, anteriorParcial,
    registroComecouEm: primeiro ? dataLocal(primeiro) : null,
  };
}

function relatorioSemanal(fonte, agora, pendenciasAbertas = null) {
  const inicioSemana = iniciarSemana(agora);
  const proximaSegunda = new Date(inicioSemana.getFullYear(), inicioSemana.getMonth(), inicioSemana.getDate() + 7);
  const inicioPassada = new Date(inicioSemana.getFullYear(), inicioSemana.getMonth(), inicioSemana.getDate() - 7);
  const registros = registrosDe(fonte);
  const primeiro = registros[0] ? new Date(registros[0]) : null;
  const rotuloSemana = (de, ate) => {
    const f = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    return `${f(de)} a ${f(new Date(ate.getFullYear(), ate.getMonth(), ate.getDate() - 1))}`;
  };
  const semana = (de, ate) => ({
    de: dataLocal(de), ate: dataLocal(new Date(ate.getFullYear(), ate.getMonth(), ate.getDate() - 1)),
    rotulo: rotuloSemana(de, ate),
    // Sem nenhum registro até o fim dela, a semana não tem dado (não é uma semana zerada).
    semDado: !primeiro || primeiro.getTime() >= ate.getTime(),
    ...contaIntervalo(fonte, de, ate),
  });
  const passada = semana(inicioPassada, inicioSemana);
  const atual = semana(inicioSemana, proximaSegunda);
  return { atual, passada, pendenciasAbertas, texto: textoDaSemana(passada) };
}

// O resumo que ele pode copiar e mandar pra si mesmo, ou pra secretária.
function textoDaSemana(s) {
  if (s.semDado) return `Semana de ${s.rotulo}: sem dado ainda.`;
  const partes = [
    `${s.novosContatos} contato${s.novosContatos === 1 ? " novo" : "s novos"}`,
    `${s.consultasMarcadas} consulta${s.consultasMarcadas === 1 ? " marcada" : "s marcadas"}`,
    `${s.consultasPagas} paga${s.consultasPagas === 1 ? "" : "s"}`,
  ];
  let texto = `Semana de ${s.rotulo}: ${partes.join(", ")}.`;
  if (s.consultasPagas > 0) {
    texto += s.pagasSemValor === s.consultasPagas
      ? " Faturamento recebido: sem dado ainda (consultas pagas sem tipo registrado)."
      : ` Faturamento recebido: ${reais(s.faturamentoCentavos)}${s.pagasSemValor ? ` (mais ${s.pagasSemValor} paga${s.pagasSemValor === 1 ? "" : "s"} sem tipo, fora da soma)` : ""}.`;
  }
  return texto;
}

// ---------------------------------------------------------------- origem e perda

function fechou(c) {
  const e = c.estagio && c.estagio.chave;
  return e === "agendou" || e === "pagou" || !!c.ehPaciente || !!c.proximaConsulta || c.totalConsultas > 0;
}

function origensEPerdas(contatos, motivos) {
  const porOrigem = new Map();
  let semOrigem = 0;
  for (const c of contatos) {
    if (!c.origem) { semOrigem++; continue; }
    if (!porOrigem.has(c.origem)) porOrigem.set(c.origem, { origem: c.origem, total: 0, fecharam: 0 });
    const o = porOrigem.get(c.origem);
    o.total++;
    if (fechou(c)) o.fecharam++;
  }
  const origens = [...porOrigem.values()].sort((a, b) => b.total - a.total || a.origem.localeCompare(b.origem));
  for (const o of origens) o.taxa = o.total ? Math.round((o.fecharam / o.total) * 100) : null;

  const porMotivo = new Map();
  for (const c of contatos) {
    if (!c.perda) continue;
    porMotivo.set(c.perda.motivo, (porMotivo.get(c.perda.motivo) || 0) + 1);
  }
  const perdas = (motivos || []).map((m) => ({ chave: m.chave, rotulo: m.rotulo, total: porMotivo.get(m.chave) || 0 }))
    .filter((m) => m.total > 0).sort((a, b) => b.total - a.total);
  return {
    origens: { semDado: origens.length === 0, lista: origens, semOrigem, comOrigem: contatos.length - semOrigem },
    perdas: { semDado: perdas.length === 0, lista: perdas, total: perdas.reduce((s, m) => s + m.total, 0) },
  };
}

// ---------------------------------------------------------------- tudo junto

function numeros({ contatos = [], contatosFunil = [], agendamentos = [], motivosPerda = [], agora = new Date(), pendenciasAbertas = null } = {}) {
  const fonte = { contatosFunil, agendamentos };
  return {
    geradoEm: agora.toISOString(),
    mensal: comparacaoMensal(fonte, agora),
    semanal: relatorioSemanal(fonte, agora, pendenciasAbertas),
    ...origensEPerdas(contatos, motivosPerda),
  };
}

module.exports = {
  BASE_MINIMA_GARGALO, FOLLOWUP_LIMITE_DIAS, TIPOS_DE_PENDENCIA,
  passagensDoFunil, pendenciasDoDia, comparacaoMensal, relatorioSemanal, textoDaSemana,
  origensEPerdas, numeros, valorDoAgendamento, iniciarSemana, mesDoIso,
};
