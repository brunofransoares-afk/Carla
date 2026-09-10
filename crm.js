// O CRM do painel: o que o Dr. Bruno vê de cada família num lugar só.
//
// Até aqui o painel tinha listas soltas (contatos, agendamentos, alertas, funil) e quem
// quisesse saber "essa mãe é paciente? tem consulta? pagou? parou onde?" tinha que cruzar
// as quatro de cabeça. Este módulo faz o cruzamento uma vez, no servidor, e devolve cada
// contato já com a situação escrita: estágio no funil, consultas (passadas e futuras),
// crianças, janela de pós-consulta, notas e etiquetas.
//
// É módulo PURO de propósito: recebe listas e devolve listas. Nada aqui lê o WhatsApp,
// nada aqui manda mensagem. Quem lê os arquivos é o painel-server; quem manda é o bot.
// Assim dá pra testar com dados inventados, sem SQLite nem rede.
"use strict";

const path = require("path");
const crypto = require("crypto");
const Atomico = require(path.join(__dirname, "arquivo-atomico.js"));

const DIA_MS = 24 * 60 * 60 * 1000;

// Os 30 dias de dúvidas pelo WhatsApp que a consulta inclui (ver cerebro-ia.js, RETORNO).
// O painel usa o mesmo número pra mostrar quem ainda está dentro da janela.
const JANELA_POS_CONSULTA_DIAS = 30;

// Depois de quanto tempo parado um lead conta como "sem resposta". Três dias é o que o
// Dr. Bruno pediu: menos que isso é gente que ainda está pensando.
const SEM_RESPOSTA_DIAS = 3;

// Um lead que soube o valor e sumiu só conta como "parou no preço" depois de algumas
// horas: nos primeiros minutos ele pode estar só conferindo o extrato.
const PAROU_NO_PRECO_HORAS = 6;

// "Lead quente" pro resumo do topo: falou nas últimas 48 horas e ainda não fechou.
const LEAD_QUENTE_HORAS = 48;

// Os marcos de acompanhamento: o Dr. Bruno gosta de rever a criança 3 e 6 meses depois
// da consulta. O painel avisa uma semana antes de cada marco e segura o aviso por três
// semanas depois, pra ele não perder o marco só por não ter aberto o painel naquela semana.
const MESES_RETORNO = [3, 6];
const AVISO_ANTES_DIAS = 7;
const AVISO_DEPOIS_DIAS = 21;

const LIMITE_NOTA = 1000;
const LIMITE_NOTAS_POR_CONTATO = 200;
const LIMITE_ETIQUETAS = 8;
const LIMITE_ETIQUETA = 24;

const TIPO_NOME = {
  urgencia: "Urgência",
  puericultura: "Puericultura",
  tnd: "Neurodesenvolvimento",
};

// Etapas na ordem do funil (registro-de-eventos.js). A mais avançada que o contato
// alcançou é o estágio dele.
const ESTAGIOS = [
  { chave: "pagou", rotulo: "Pagou" },
  { chave: "agendou", rotulo: "Agendou" },
  { chave: "recebeuHorario", rotulo: "Recebeu horário" },
  { chave: "recebeuPreco", rotulo: "Soube o valor" },
  { chave: "contatos", rotulo: "Chamou" },
];

// As situações que viram filtro na tela. A ordem aqui é a ordem dos botões.
const SITUACOES = [
  { chave: "aguardando_humano", rotulo: "Aguardando você", tom: "atencao" },
  { chave: "aguardando_pagamento", rotulo: "Aguardando pagamento", tom: "atencao" },
  { chave: "consulta_marcada", rotulo: "Consulta marcada", tom: "bom" },
  { chave: "fechou_com_voce", rotulo: "Fechou com você", tom: "bom" },
  { chave: "retorno_proximo", rotulo: "Retorno de 3 ou 6 meses", tom: "atencao" },
  { chave: "pos_consulta", rotulo: "Pós-consulta (30 dias)", tom: "info" },
  { chave: "parou_no_preco", rotulo: "Parou depois do valor", tom: "perda" },
  { chave: "sem_resposta", rotulo: "Sem resposta há 3+ dias", tom: "perda" },
  { chave: "lead", rotulo: "Lead", tom: "neutro" },
  { chave: "paciente", rotulo: "Paciente", tom: "bom" },
  { chave: "silenciado", rotulo: "Silenciado", tom: "neutro" },
];

// Modelos de mensagem pós-consulta. O botão preenche a caixa de mensagem; o Dr. Bruno
// ainda lê, ajusta se quiser, e manda. Nada sai sem o dedo dele.
//
// carlaContinua: quase todos calam a Carla depois do envio, porque a resposta da família
// tende a ser clínica ("ele ainda está com febre") e isso é conversa do médico. O único
// que deixa a Carla ligada é o convite pra rotina: ali a resposta esperada é "quero
// marcar", que é exatamente o que ela sabe fazer.
const MODELOS_POS_CONSULTA = [
  {
    id: "como_esta",
    nome: "Como está?",
    quando: "1 ou 2 dias depois da consulta",
    carlaContinua: false,
    texto: "Oi, {responsavel}! Aqui é do consultório do Dr. Bruno. Passando pra saber como {crianca} está depois da consulta. Se surgir qualquer dúvida nesses 30 dias, pode mandar por aqui.",
  },
  {
    id: "pedir_exames",
    nome: "Pedir os exames",
    quando: "quando o Dr. Bruno pediu exames",
    carlaContinua: false,
    texto: "Oi, {responsavel}! Quando os exames de {crianca} ficarem prontos, é só mandar as fotos ou o PDF por aqui. O Dr. Bruno avalia e te retorna por esta conversa.",
  },
  {
    id: "exames_recebidos",
    nome: "Exames recebidos",
    quando: "assim que os exames chegarem",
    carlaContinua: false,
    texto: "Oi, {responsavel}! Recebi os exames de {crianca}. O Dr. Bruno vai avaliar e eu te retorno por aqui com a orientação dele.",
  },
  {
    id: "fim_dos_30_dias",
    nome: "Fim dos 30 dias",
    quando: "por volta do dia 25 depois da consulta",
    carlaContinua: false,
    texto: "Oi, {responsavel}! O acompanhamento de {crianca} pelo WhatsApp está chegando ao fim dos 30 dias. Se ficou alguma dúvida da consulta, aproveita e manda por aqui.",
  },
  {
    id: "avaliacao",
    nome: "Pedir avaliação",
    quando: "depois de uma consulta que correu bem",
    carlaContinua: false,
    precisaDe: "linkAvaliacao",
    texto: "Oi, {responsavel}! Foi um prazer receber {crianca} no consultório. Se puder, deixa uma avaliação do Dr. Bruno no Google: ajuda muito outras famílias a nos encontrar. {linkAvaliacao}",
  },
  {
    id: "retorno",
    nome: "Recado de retorno",
    quando: "no marco de 3 ou 6 meses",
    carlaContinua: true,
    texto: "Oi, {responsavel}! Aqui é a Carla, do consultório do Dr. Bruno. A consulta de {crianca} foi há {meses} meses, e o Dr. Bruno gosta de rever as crianças nessa época pra acompanhar de perto o crescimento e o desenvolvimento. Se quiser marcar, me conta se prefere de manhã ou à tarde que eu vejo um horário.",
  },
  {
    id: "rotina",
    nome: "Chamar pra rotina",
    quando: "meses depois, pra puericultura",
    carlaContinua: true,
    texto: "Oi, {responsavel}! Aqui é a Carla, do consultório do Dr. Bruno. Já faz um tempo desde a última consulta de {crianca}. Se quiser marcar a consulta de rotina, me conta se prefere de manhã ou à tarde que eu vejo um horário.",
  },
];

// ---------------------------------------------------------------- utilidades

function dataLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

function horasDesde(iso, agora) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (agora.getTime() - t) / (60 * 60 * 1000);
}

function diasEntreDatas(dataStr, agora) {
  const [y, m, d] = String(dataStr).split("-").map(Number);
  const alvo = new Date(y, m - 1, d);
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  return Math.round((hoje - alvo) / DIA_MS);
}

// Soma meses a uma data AAAA-MM-DD sem estourar o mês: 31/01 + 3 meses é 30/04, não 01/05.
function somarMeses(dataStr, meses) {
  const [y, m, d] = String(dataStr).split("-").map(Number);
  const alvo = new Date(y, m - 1 + meses, 1);
  const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(d, ultimoDia));
  return dataLocal(alvo);
}

// Os marcos de retorno da última consulta realizada. Cada um diz quantos dias faltam (negativo
// se já passou), se o Dr. Bruno já marcou como avisado, e se está pendente: dentro da janela
// (uma semana antes até três semanas depois) e ainda não avisado.
function marcosDeRetorno({ ultimaRealizada = null, retornosAvisados = {}, agora = new Date() } = {}) {
  if (!ultimaRealizada || !ultimaRealizada.data) return [];
  return MESES_RETORNO.map((meses) => {
    const data = somarMeses(ultimaRealizada.data, meses);
    const diasFaltando = -diasEntreDatas(data, agora);
    const chave = `${ultimaRealizada.data}:${meses}`;
    const avisadoEm = retornosAvisados[chave] || null;
    const naJanela = diasFaltando <= AVISO_ANTES_DIAS && diasFaltando >= -AVISO_DEPOIS_DIAS;
    return { meses, data, chave, diasFaltando, avisadoEm, naJanela, pendente: naJanela && !avisadoEm, crianca: ultimaRealizada.crianca || null, consultaEm: ultimaRealizada.data };
  });
}

function nomeDoTipo(tipo) {
  return TIPO_NOME[tipo] || (tipo ? String(tipo) : "Consulta");
}

// ---------------------------------------------------------------- consultas

// Consultas de um telefone, todas (ativas, pagas, canceladas, vencidas), da mais recente
// pra mais antiga. É o histórico da família, não a agenda.
function consultasDoTelefone(agendamentos, telefone) {
  return (agendamentos || [])
    .filter((a) => a && a.telefone === telefone)
    .map((a) => ({
      slotId: a.slotId,
      data: a.data,
      horario: a.horario,
      diaLabel: a.diaLabel || null,
      crianca: a.crianca || null,
      responsavel: a.responsavel || null,
      responsavelEmail: a.responsavelEmail || null,
      estado: a.estado || (a.pago ? "pago" : "reservado"),
      pago: !!a.pago,
      pagamento: a.pagamento || null,
      modalidade: a.modalidade === "teleconsulta" ? "teleconsulta" : "presencial",
      tipoConsulta: a.tipoConsulta || null,
      tipoNome: a.tipoConsulta ? nomeDoTipo(a.tipoConsulta) : "Consulta",
      portalAvisadoEm: a.portalAvisadoEm || null,
      guiaAvisadoEm: a.guiaAvisadoEm || null,
      registradoEm: a.registradoEm || null,
    }))
    .sort((a, b) => (b.data + b.horario).localeCompare(a.data + a.horario));
}

// Consulta feita fora da Carla, registrada à mão na ficha. Entra na lista com o mesmo
// formato das outras, com estado "realizada", pra tela e contagens não precisarem de dois
// caminhos.
function consultasManuaisDoTelefone(dadosCrm, telefone) {
  const lista = (dadosCrm && dadosCrm.consultasRealizadas && dadosCrm.consultasRealizadas[telefone]) || [];
  return lista.map((c) => ({
    slotId: `manual-${c.id}`, id: c.id, data: c.data, horario: "", diaLabel: null,
    crianca: c.crianca || null, responsavel: null, responsavelEmail: null,
    estado: "realizada", pago: true, pagamento: null, modalidade: "presencial",
    tipoConsulta: c.tipoConsulta || null, tipoNome: c.tipoConsulta ? nomeDoTipo(c.tipoConsulta) : "Consulta",
    portalAvisadoEm: null, guiaAvisadoEm: null, registradoEm: c.em || null, origem: "manual",
  }));
}

function todasAsConsultas(agendamentos, dadosCrm, telefone) {
  return [...consultasDoTelefone(agendamentos, telefone), ...consultasManuaisDoTelefone(dadosCrm, telefone)]
    .sort((a, b) => (b.data + b.horario).localeCompare(a.data + a.horario));
}

function ativa(c) {
  return c.estado === "reservado" || c.estado === "pago";
}

// Aconteceu de verdade: passou a data sem cancelar, ou foi registrada à mão como realizada.
function realizada(c, hoje) {
  return c.estado === "realizada" || (ativa(c) && c.data < hoje);
}

// ---------------------------------------------------------------- estágio e situações

function estagioDe(flags) {
  if (!flags) return { chave: "sem_registro", rotulo: "Sem registro" };
  // Marcado como paciente no painel: é conversão (o funil já contou como "agendou"), mas a
  // ficha diz de onde veio, porque não existe reserva da Carla pra essa família.
  if (flags.fechouComDoutor && !flags.pagou) return { chave: "agendou", rotulo: "Fechou com você" };
  for (const e of ESTAGIOS) {
    if (e.chave === "contatos" || flags[e.chave]) return { chave: e.chave, rotulo: e.rotulo };
  }
  return { chave: "contatos", rotulo: "Chamou" };
}

// Lê a situação de UM contato. Recebe tudo já separado pra ser fácil de testar.
function situacoesDe({ contato, consultas, flags, agora, retornosAvisados = {} }) {
  const hoje = dataLocal(agora);
  const futuras = consultas.filter((c) => ativa(c) && c.data >= hoje);
  // Consulta que já aconteceu: passou a data e não foi cancelada nem venceu sem pagar, ou
  // foi registrada à mão na ficha.
  const realizadas = consultas.filter((c) => realizada(c, hoje));
  const ultimaRealizada = realizadas[0] || null;
  const proxima = futuras.slice().sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario))[0] || null;

  const lista = [];
  const detalhes = {};

  if (contato.aguardandoHumano) lista.push("aguardando_humano");
  if (futuras.some((c) => !c.pago)) lista.push("aguardando_pagamento");
  if (futuras.length) lista.push("consulta_marcada");
  if (flags && flags.fechouComDoutor) lista.push("fechou_com_voce");

  if (ultimaRealizada) {
    const diasDesde = diasEntreDatas(ultimaRealizada.data, agora);
    if (diasDesde >= 0 && diasDesde <= JANELA_POS_CONSULTA_DIAS) {
      lista.push("pos_consulta");
      detalhes.posConsulta = {
        diasDesde,
        diasRestantes: JANELA_POS_CONSULTA_DIAS - diasDesde,
        crianca: ultimaRealizada.crianca,
        data: ultimaRealizada.data,
      };
    }
  }

  // Os marcos de 3 e 6 meses contam da ÚLTIMA consulta realizada: uma consulta nova zera a
  // contagem, porque a criança acabou de ser vista.
  const retornos = marcosDeRetorno({ ultimaRealizada, retornosAvisados, agora });
  const retornoPendente = retornos.find((r) => r.pendente) || null;
  if (retornoPendente) {
    lista.push("retorno_proximo");
    detalhes.retornoPendente = retornoPendente;
  }

  const ehPaciente = !!contato.ehPaciente || realizadas.length > 0;
  const horasParado = horasDesde(contato.ultimaAtividade, agora);
  const fechou = !!(flags && flags.agendou) || futuras.length > 0 || realizadas.length > 0;

  if (!fechou && flags && flags.recebeuPreco && horasParado !== null && horasParado >= PAROU_NO_PRECO_HORAS) {
    lista.push("parou_no_preco");
  }
  if (!fechou && horasParado !== null && horasParado >= SEM_RESPOSTA_DIAS * 24) {
    lista.push("sem_resposta");
  }

  // Lead é quem falou e nunca chegou a ter consulta, nem marcada. Quem reservou já saiu
  // dessa lista: a situação dele é "consulta marcada" (e "aguardando pagamento", se for o caso).
  if (ehPaciente) lista.push("paciente");
  else if (contato.ultimaAtividade && futuras.length === 0) lista.push("lead");
  if (contato.silenciado) lista.push("silenciado");

  return { situacoes: lista, detalhes, proxima, ultimaRealizada, futuras, realizadas, ehPaciente, retornos };
}

// ---------------------------------------------------------------- a lista inteira

// contatos: Storage.listarTodosContatos()
// agendamentos: Storage.lerTodosAgendamentos() (com inativos: histórico importa aqui)
// funilContatos: Eventos.funil().contatos (flags por telefone)
// dadosCrm: lerCrm() (notas e etiquetas)
function montarCrm({ contatos = [], agendamentos = [], funilContatos = [], dadosCrm = null, agora = new Date() } = {}) {
  const flagsPorTelefone = new Map((funilContatos || []).map((f) => [f.telefone, f]));
  const crm = dadosCrm || { notas: {}, etiquetas: {}, consultasRealizadas: {}, retornos: {} };
  const hoje = dataLocal(agora);

  // Quem marcou consulta mas nunca apareceu na lista de contatos (reserva antiga, número
  // sem sessão) entra mesmo assim: no CRM a família existe porque a consulta existe.
  const telefonesConhecidos = new Set(contatos.map((c) => c.telefone));
  const extras = [];
  for (const a of agendamentos) {
    if (a && a.telefone && !telefonesConhecidos.has(a.telefone)) {
      telefonesConhecidos.add(a.telefone);
      extras.push({ telefone: a.telefone, nome: a.responsavel || null, ehPaciente: false, ultimaAtividade: null, ultimaMensagem: "", fechou: false, aguardandoHumano: false, silenciado: false });
    }
  }
  for (const telefone of Object.keys(crm.consultasRealizadas || {})) {
    if (!telefonesConhecidos.has(telefone) && (crm.consultasRealizadas[telefone] || []).length) {
      telefonesConhecidos.add(telefone);
      extras.push({ telefone, nome: null, ehPaciente: false, ultimaAtividade: null, ultimaMensagem: "", fechou: false, aguardandoHumano: false, silenciado: false });
    }
  }

  const lista = [...contatos, ...extras].map((contato) => {
    const consultas = todasAsConsultas(agendamentos, crm, contato.telefone);
    const flags = flagsPorTelefone.get(contato.telefone) || null;
    const s = situacoesDe({ contato, consultas, flags, agora, retornosAvisados: (crm.retornos && crm.retornos[contato.telefone]) || {} });
    const notas = (crm.notas && crm.notas[contato.telefone]) || [];
    const etiquetas = (crm.etiquetas && crm.etiquetas[contato.telefone]) || [];
    const criancas = [...new Set(consultas.map((c) => c.crianca).filter(Boolean))];
    const responsavel = consultas.map((c) => c.responsavel).find(Boolean) || null;
    return {
      ...contato,
      nome: contato.nome || responsavel || null,
      responsavel,
      criancas,
      estagio: estagioDe(flags),
      primeiraPergunta: (flags && flags.primeiraPergunta) || null,
      primeiroContatoEm: (flags && flags.primeiroContatoEm) || null,
      situacoes: s.situacoes,
      posConsulta: s.detalhes.posConsulta || null,
      retornos: s.retornos,
      retornoPendente: s.detalhes.retornoPendente || null,
      ehPaciente: s.ehPaciente,
      proximaConsulta: s.proxima,
      ultimaConsulta: s.ultimaRealizada,
      totalConsultas: s.realizadas.length + s.futuras.length,
      consultasCanceladas: consultas.filter((c) => c.estado === "cancelado").length,
      notas: notas.length,
      ultimaNota: notas.length ? notas[notas.length - 1].texto : null,
      etiquetas,
    };
  });

  // Ordem: quem precisa do Dr. Bruno primeiro, depois por atividade.
  const peso = (c) => (c.situacoes.includes("aguardando_humano") ? 0 : c.situacoes.includes("aguardando_pagamento") ? 1 : c.situacoes.includes("retorno_proximo") ? 2 : 3);
  lista.sort((a, b) => {
    const p = peso(a) - peso(b);
    if (p !== 0) return p;
    const ta = a.ultimaAtividade ? new Date(a.ultimaAtividade).getTime() : 0;
    const tb = b.ultimaAtividade ? new Date(b.ultimaAtividade).getTime() : 0;
    if (ta !== tb) return tb - ta;
    return String(a.nome || a.telefone).localeCompare(String(b.nome || b.telefone));
  });

  const contagem = {};
  for (const s of SITUACOES) contagem[s.chave] = lista.filter((c) => c.situacoes.includes(s.chave)).length;

  const em7dias = dataLocal(new Date(agora.getTime() + 7 * DIA_MS));
  const ativasFuturas = agendamentos.filter((a) => a && ativa(a) && a.data >= hoje);
  const resumo = {
    consultasHoje: ativasFuturas.filter((a) => a.data === hoje).length,
    consultasSemana: ativasFuturas.filter((a) => a.data <= em7dias).length,
    aguardandoPagamento: ativasFuturas.filter((a) => !a.pago).length,
    aguardandoVoce: contagem.aguardando_humano,
    leadsQuentes: lista.filter((c) => {
      const h = horasDesde(c.ultimaAtividade, agora);
      return h !== null && h <= LEAD_QUENTE_HORAS && !c.ehPaciente && !c.proximaConsulta && !c.silenciado;
    }).length,
    posConsulta: contagem.pos_consulta,
    retornosAAvisar: contagem.retorno_proximo,
    pacientes: contagem.paciente,
    leads: contagem.lead,
    totalContatos: lista.length,
  };

  return { contatos: lista, resumo, contagem, situacoes: SITUACOES, agora: agora.toISOString() };
}

// ---------------------------------------------------------------- linha do tempo

const ROTULO_EVENTO = {
  contato: () => "Primeiro contato com a Carla",
  mensagem: (e) => (e.trecho ? `Família: "${e.trecho}"` : "Mensagem da família"),
  preco_informado: (e) => `Soube o valor${e.valorCentavos ? ` (R$ ${(e.valorCentavos / 100).toFixed(0)})` : ""}`,
  horarios_oferecidos: () => "Recebeu opções de horário",
  agendou: (e) => `Agendou${e.crianca ? ` ${e.crianca}` : ""}${e.quando ? `, ${e.quando}` : ""}`,
  cancelou: (e) => `Cancelou${e.crianca ? ` a consulta de ${e.crianca}` : ""}`,
  pagou: () => "Pagamento marcado",
  pagamento_desmarcado: () => "Pagamento desmarcado",
  escalou: (e) => `Escalou pro Dr. Bruno${e.motivo ? `: ${e.motivo}` : ""}`,
  reaquecido: () => "Mensagem de retomada enviada",
  virou_paciente: () => "Marcado como paciente no painel (conta como conversão)",
  paciente_desmarcado: () => "Marcação de paciente removida",
  mensagem_manual: (e) => `Consultório: "${e.trecho || ""}"`,
};

function linhaDoTempo({ eventos = [], notas = [], consultasManuais = [], retornosAvisados = {}, limite = 60 } = {}) {
  const itens = [];
  for (const c of consultasManuais) {
    if (!c || !c.em) continue;
    itens.push({ em: c.em, tipo: "consulta_manual", texto: `Consulta de ${c.data.split("-").reverse().join("/")}${c.crianca ? ` (${c.crianca})` : ""} registrada como realizada no painel` });
  }
  for (const [chave, em] of Object.entries(retornosAvisados || {})) {
    const meses = chave.split(":")[1];
    itens.push({ em, tipo: "retorno_avisado", texto: `Retorno de ${meses} meses marcado como avisado` });
  }
  for (const e of eventos) {
    if (!e || !e.em || !e.tipo) continue;
    const rotulo = ROTULO_EVENTO[e.tipo];
    itens.push({ em: e.em, tipo: e.tipo, texto: rotulo ? rotulo(e) : e.tipo });
  }
  for (const n of notas) {
    if (!n || !n.em) continue;
    itens.push({ em: n.em, tipo: "nota", texto: `Nota: ${n.texto}` });
  }
  itens.sort((a, b) => b.em.localeCompare(a.em));
  return itens.slice(0, limite);
}

// ---------------------------------------------------------------- modelos

// Preenche um modelo pra uma família. Sem nome do responsável o "Oi, {responsavel}!" vira
// "Oi!"; sem nome da criança entra "seu filho(a)", que lê bem em todas as frases acima.
function preencherModelo(modelo, { responsavel = null, crianca = null, linkAvaliacao = null, meses = null } = {}) {
  if (!modelo) return { ok: false, motivo: "Modelo desconhecido." };
  if (modelo.precisaDe === "linkAvaliacao" && !linkAvaliacao) {
    return { ok: false, motivo: "Configure LINK_AVALIACAO_GOOGLE no .env pra usar este modelo." };
  }
  let texto = modelo.texto;
  texto = responsavel ? texto.replace("{responsavel}", responsavel) : texto.replace(", {responsavel}!", "!");
  texto = texto.replace(/\{crianca\}/g, crianca || "seu filho(a)");
  texto = texto.replace("{linkAvaliacao}", linkAvaliacao || "").trim();
  texto = texto.replace("{meses}", meses ? String(meses) : "alguns");
  return { ok: true, texto, carlaContinua: !!modelo.carlaContinua };
}

function modelosPara({ responsavel = null, crianca = null, linkAvaliacao = null, meses = null } = {}) {
  return MODELOS_POS_CONSULTA.map((m) => {
    const p = preencherModelo(m, { responsavel, crianca, linkAvaliacao, meses });
    return { id: m.id, nome: m.nome, quando: m.quando, carlaContinua: !!m.carlaContinua, disponivel: p.ok, motivo: p.ok ? null : p.motivo, texto: p.ok ? p.texto : null };
  });
}

// ---------------------------------------------------------------- conversão retroativa

// Quem já estava marcado como paciente ANTES de o clique virar evento de conversão. Sem
// isto o painel subia dizendo 0% de conversão com dezoito pacientes marcados: o funil só
// sabe o que está no registro, e essas marcações foram feitas quando o clique não registrava
// nada. Devolve quem precisa ganhar o evento, datado na última conversa (a melhor
// aproximação de quando fechou), pra entrar no período certo do funil.
//
// Regras iguais às do clique: só quem tem sessão (falou com a Carla), e só se não existe
// virou_paciente depois do último paciente_desmarcado.
function pacientesSemConversao({ pacientesManuais = [], sessoes = {}, eventos = [], agora = new Date() } = {}) {
  const estado = new Map();
  for (const e of eventos) {
    if (!e || !e.telefone) continue;
    if (e.tipo === "virou_paciente") estado.set(e.telefone, true);
    if (e.tipo === "paciente_desmarcado") estado.set(e.telefone, false);
  }
  const lista = [];
  for (const telefone of pacientesManuais) {
    const sessao = sessoes[telefone];
    if (!sessao) continue;
    if (estado.get(telefone) === true) continue;
    const em = new Date(sessao.ultimaAtividade || "");
    lista.push({ telefone, em: Number.isNaN(em.getTime()) ? agora : em });
  }
  return lista;
}

// ---------------------------------------------------------------- notas e etiquetas

function lerCrm(arquivo) {
  const dados = Atomico.lerJSONSeguro(arquivo, null);
  if (!dados || typeof dados !== "object") return { notas: {}, etiquetas: {}, consultasRealizadas: {}, retornos: {} };
  return { notas: dados.notas || {}, etiquetas: dados.etiquetas || {}, consultasRealizadas: dados.consultasRealizadas || {}, retornos: dados.retornos || {} };
}

// Consulta feita fora da Carla (o Dr. Bruno assumiu a conversa e marcou por fora, ou é
// paciente antigo). Registrada aqui, ela conta como realizada: abre a janela de pós-consulta
// e a contagem dos retornos de 3 e 6 meses.
function registrarConsultaRealizada(arquivo, telefone, { data, crianca = null, tipoConsulta = null } = {}, agora = new Date()) {
  if (!telefone) return { ok: false, motivo: "Sem telefone." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ""))) return { ok: false, motivo: "Data inválida." };
  if (data > dataLocal(agora)) return { ok: false, motivo: "A consulta ainda não aconteceu: registre só depois." };
  const dados = lerCrm(arquivo);
  const lista = dados.consultasRealizadas[telefone] || [];
  const nomeCrianca = limparTexto(crianca, 80) || null;
  if (lista.some((c) => c.data === data && (c.crianca || null) === nomeCrianca)) return { ok: false, motivo: "Essa consulta já está registrada." };
  const consulta = { id: crypto.randomBytes(6).toString("hex"), data, crianca: nomeCrianca, tipoConsulta: tipoValidoOuNulo(tipoConsulta), em: agora.toISOString() };
  dados.consultasRealizadas[telefone] = [...lista, consulta].slice(-100);
  Atomico.escreverJSONAtomico(arquivo, dados);
  return { ok: true, consulta };
}

function tipoValidoOuNulo(tipo) {
  return TIPO_NOME[tipo] ? tipo : null;
}

function removerConsultaRealizada(arquivo, telefone, id) {
  const dados = lerCrm(arquivo);
  const lista = dados.consultasRealizadas[telefone] || [];
  const restante = lista.filter((c) => c.id !== id);
  if (restante.length === lista.length) return { ok: false, motivo: "Consulta não encontrada." };
  if (restante.length) dados.consultasRealizadas[telefone] = restante;
  else delete dados.consultasRealizadas[telefone];
  Atomico.escreverJSONAtomico(arquivo, dados);
  return { ok: true };
}

// O Dr. Bruno mandou o recado (ou decidiu não mandar): o aviso daquele marco some. A chave
// é "data da consulta:meses", então uma consulta nova gera marcos novos, sem confusão.
function marcarRetornoAvisado(arquivo, telefone, chave, avisado = true, agora = new Date()) {
  if (!telefone || !/^\d{4}-\d{2}-\d{2}:(3|6)$/.test(String(chave || ""))) return { ok: false, motivo: "Marco inválido." };
  const dados = lerCrm(arquivo);
  const doTelefone = dados.retornos[telefone] || {};
  if (avisado) doTelefone[chave] = agora.toISOString();
  else delete doTelefone[chave];
  if (Object.keys(doTelefone).length) dados.retornos[telefone] = doTelefone;
  else delete dados.retornos[telefone];
  Atomico.escreverJSONAtomico(arquivo, dados);
  return { ok: true, retornos: doTelefone };
}

function limparTexto(texto, limite) {
  return String(texto || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, limite);
}

function adicionarNota(arquivo, telefone, texto, agora = new Date()) {
  const limpo = limparTexto(texto, LIMITE_NOTA);
  if (!telefone) return { ok: false, motivo: "Sem telefone." };
  if (!limpo) return { ok: false, motivo: "Nota vazia." };
  const dados = lerCrm(arquivo);
  const lista = dados.notas[telefone] || [];
  const nota = { id: crypto.randomBytes(6).toString("hex"), em: agora.toISOString(), texto: limpo };
  dados.notas[telefone] = [...lista, nota].slice(-LIMITE_NOTAS_POR_CONTATO);
  Atomico.escreverJSONAtomico(arquivo, dados);
  return { ok: true, nota, notas: dados.notas[telefone] };
}

function removerNota(arquivo, telefone, id) {
  const dados = lerCrm(arquivo);
  const lista = dados.notas[telefone] || [];
  const restante = lista.filter((n) => n.id !== id);
  if (restante.length === lista.length) return { ok: false, motivo: "Nota não encontrada.", notas: lista };
  dados.notas[telefone] = restante;
  Atomico.escreverJSONAtomico(arquivo, dados);
  return { ok: true, notas: restante };
}

function definirEtiquetas(arquivo, telefone, etiquetas) {
  if (!telefone) return { ok: false, motivo: "Sem telefone." };
  const limpas = [...new Set((Array.isArray(etiquetas) ? etiquetas : [])
    .map((e) => limparTexto(e, LIMITE_ETIQUETA))
    .filter(Boolean))].slice(0, LIMITE_ETIQUETAS);
  const dados = lerCrm(arquivo);
  if (limpas.length) dados.etiquetas[telefone] = limpas;
  else delete dados.etiquetas[telefone];
  Atomico.escreverJSONAtomico(arquivo, dados);
  return { ok: true, etiquetas: limpas };
}

module.exports = {
  JANELA_POS_CONSULTA_DIAS, SEM_RESPOSTA_DIAS, PAROU_NO_PRECO_HORAS, LEAD_QUENTE_HORAS,
  MESES_RETORNO, AVISO_ANTES_DIAS, AVISO_DEPOIS_DIAS,
  SITUACOES, ESTAGIOS, MODELOS_POS_CONSULTA, TIPO_NOME,
  consultasDoTelefone, consultasManuaisDoTelefone, todasAsConsultas, estagioDe, situacoesDe, montarCrm, linhaDoTempo,
  somarMeses, marcosDeRetorno,
  preencherModelo, modelosPara,
  lerCrm, adicionarNota, removerNota, definirEtiquetas,
  registrarConsultaRealizada, removerConsultaRealizada, marcarRetornoAvisado,
  pacientesSemConversao,
  _dataLocal: dataLocal,
};
