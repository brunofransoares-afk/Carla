// Persistência em disco (equivalente ao localStorage da versão de teste no navegador).
// Mesma responsabilidade do storage.js do carla-app: é a única peça que muda
// quando se troca onde os dados ficam guardados. A lógica da Carla nunca toca aqui direto.

const fs = require("fs");
const path = require("path");

// Garante CARLA_CONFIG (global) antes do Agenda, que depende dele — precisa disso aqui
// porque o painel (painel-server.js) usa este arquivo sem nunca ter carregado config.js.
require(path.join(__dirname, "..", "carla-app", "js", "config.js"));
const Agenda = require(path.join(__dirname, "..", "carla-app", "js", "agenda.js"));

const DIR_DADOS = path.join(__dirname, "data");
const ARQ_AGENDAMENTOS = path.join(DIR_DADOS, "agendamentos.json");
const ARQ_AGENDAMENTOS_CSV = path.join(DIR_DADOS, "agendamentos.csv");
const ARQ_ALERTAS = path.join(DIR_DADOS, "alertas.json");
const ARQ_SESSOES = path.join(DIR_DADOS, "sessoes.json");
const ARQ_BLOQUEIOS = path.join(DIR_DADOS, "bloqueios.json");
const ARQ_BLOQUEIOS_HORARIOS = path.join(DIR_DADOS, "bloqueios-horarios.json");
const ARQ_SILENCIADOS = path.join(DIR_DADOS, "contatos-silenciados.json");
const ARQ_CONTATOS_WHATSAPP = path.join(DIR_DADOS, "contatos-whatsapp.json");
const ARQ_PACIENTES_MANUAIS = path.join(DIR_DADOS, "pacientes-manuais.json");

function garantirPasta() {
  if (!fs.existsSync(DIR_DADOS)) fs.mkdirSync(DIR_DADOS, { recursive: true });
}

function lerJSON(caminho, padrao) {
  garantirPasta();
  if (!fs.existsSync(caminho)) return padrao;
  try {
    return JSON.parse(fs.readFileSync(caminho, "utf8"));
  } catch {
    return padrao;
  }
}

function escreverJSON(caminho, dados) {
  garantirPasta();
  fs.writeFileSync(caminho, JSON.stringify(dados, null, 2), "utf8");
}

function lerAgendamentos() {
  return lerJSON(ARQ_AGENDAMENTOS, []);
}

// Dias bloqueados contam como "ocupados" pra todos os horários daquele dia — assim o
// resto do sistema (consultar_horarios, doisSeguidos, urgente etc.) nunca precisa saber
// que bloqueio existe, só enxerga que não sobrou vaga nesse dia. Reservas já feitas
// num dia que depois foi bloqueado continuam valendo (bloqueio só afeta vaga nova).
function idsOcupados(now = new Date()) {
  const reais = lerAgendamentos().map((a) => a.slotId);
  const bloqueios = new Set(lerBloqueios());
  const dosBloqueios = bloqueios.size === 0
    ? []
    : Agenda.gerarSlotsPossiveis(now).filter((s) => bloqueios.has(s.date)).map((s) => s.id);
  return new Set([...reais, ...dosBloqueios, ...lerBloqueiosHorarios()]);
}

// Bloqueio de um horário específico (não o dia inteiro) — pra quando só um horário
// precisa sair de circulação (ex: compromisso pessoal do Dr. Bruno naquele horário).
function lerBloqueiosHorarios() {
  return lerJSON(ARQ_BLOQUEIOS_HORARIOS, []);
}

function alternarBloqueioHorario(slotId) {
  const lista = lerBloqueiosHorarios();
  const idx = lista.indexOf(slotId);
  if (idx >= 0) lista.splice(idx, 1);
  else lista.push(slotId);
  escreverJSON(ARQ_BLOQUEIOS_HORARIOS, lista);
  return lista;
}

// Todos os horários de um dia específico, já cruzados com agendamento real, bloqueio do
// dia inteiro e bloqueio individual — pro painel mostrar e deixar bloquear um por um.
function listarHorariosDoDia(dataStr, now = new Date()) {
  const agendamentos = lerAgendamentos();
  const diaTodoBloqueado = lerBloqueios().includes(dataStr);
  const bloqueiosHorarios = new Set(lerBloqueiosHorarios());
  const horarios = Agenda.gerarSlotsPossiveis(now)
    .filter((s) => s.date === dataStr)
    .map((s) => {
      const agendamento = agendamentos.find((a) => a.slotId === s.id);
      return {
        slotId: s.id,
        time: s.time,
        ocupado: !!agendamento,
        responsavel: agendamento ? agendamento.responsavel : null,
        crianca: agendamento ? agendamento.crianca : null,
        bloqueado: diaTodoBloqueado || bloqueiosHorarios.has(s.id),
      };
    });
  return { diaTodoBloqueado, horarios };
}

function lerBloqueios() {
  return lerJSON(ARQ_BLOQUEIOS, []);
}

// Alterna o bloqueio de um dia (AAAA-MM-DD): se já estava bloqueado, desbloqueia; senão,
// bloqueia. Retorna a lista atualizada de dias bloqueados.
function alternarBloqueioDia(data) {
  const lista = lerBloqueios();
  const idx = lista.indexOf(data);
  if (idx >= 0) {
    lista.splice(idx, 1);
  } else {
    lista.push(data);
  }
  escreverJSON(ARQ_BLOQUEIOS, lista);
  return lista;
}

function formatarDataBR(isoDate) {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function reescreverCSV(lista) {
  const linhas = [
    ["Nome do responsável", "Nome da criança", "Telefone", "Data da consulta", "Horário", "Registrado em"],
    ...lista.map((a) => [
      a.responsavel, a.crianca, a.telefone, formatarDataBR(a.data), a.horario,
      new Date(a.registradoEm).toLocaleString("pt-BR"),
    ]),
  ];
  const csv = linhas.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  fs.writeFileSync(ARQ_AGENDAMENTOS_CSV, "﻿" + csv, "utf8");
}

// Retorna false se o horário já tiver sido reservado por outra família (nunca deixa duplicar).
function reservar({ slot, responsavel, crianca, telefone, googleEventId = null }) {
  const lista = lerAgendamentos();
  if (lista.some((a) => a.slotId === slot.id)) return false;
  lista.push({
    slotId: slot.id,
    data: slot.date,
    horario: slot.time,
    diaLabel: slot.label,
    responsavel,
    crianca,
    telefone,
    registradoEm: new Date().toISOString(),
    lembretes: { semanaAntes: false, diaDaConsulta: false },
    googleEventId,
    appAgendamentoId: null,
  });
  escreverJSON(ARQ_AGENDAMENTOS, lista);
  reescreverCSV(lista);
  return true;
}

// Preenche o id do registro criado no Sistema Pediátrico Integrado depois que o envio (fora
// do fluxo síncrono do agendamento) responde — assim dá pra cancelar lá também depois.
function definirAppAgendamentoId(slotId, appAgendamentoId) {
  const lista = lerAgendamentos();
  const item = lista.find((a) => a.slotId === slotId);
  if (!item) return;
  item.appAgendamentoId = appAgendamentoId;
  escreverJSON(ARQ_AGENDAMENTOS, lista);
}

// Agendamentos com telefone de verdade (não placeholder tipo "(a confirmar)") que ainda não
// receberam o lembrete do tipo pedido e cuja data bate com o alvo de hoje ("diaDaConsulta" =
// hoje; "semanaAntes" = daqui a 7 dias).
function agendamentosProntosParaLembrete(hojeStr, tipo) {
  let dataAlvo = hojeStr;
  if (tipo === "semanaAntes") {
    const d = new Date(hojeStr + "T00:00:00");
    d.setDate(d.getDate() + 7);
    dataAlvo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return lerAgendamentos().filter((a) =>
    typeof a.telefone === "string" && a.telefone.startsWith("+")
    && a.data === dataAlvo
    && !(a.lembretes && a.lembretes[tipo])
  );
}

function marcarLembreteEnviado(slotId, tipo) {
  const lista = lerAgendamentos();
  const item = lista.find((a) => a.slotId === slotId);
  if (!item) return;
  item.lembretes = { semanaAntes: false, diaDaConsulta: false, ...(item.lembretes || {}), [tipo]: true };
  escreverJSON(ARQ_AGENDAMENTOS, lista);
}

// Cancela (apaga) um agendamento pelo slotId. Retorna o registro removido (inclui
// googleEventId, se tiver, pra quem chamar poder cancelar o evento na agenda também),
// ou null se não encontrar.
function cancelarAgendamento(slotId) {
  const lista = lerAgendamentos();
  const removido = lista.find((a) => a.slotId === slotId);
  if (!removido) return null;
  const nova = lista.filter((a) => a.slotId !== slotId);
  escreverJSON(ARQ_AGENDAMENTOS, nova);
  reescreverCSV(nova);
  return removido;
}

function lerAlertas() {
  return lerJSON(ARQ_ALERTAS, []);
}

function registrarAlertaUrgencia({ telefone, mensagem, tipo = "emergencia" }) {
  const lista = lerAlertas();
  lista.push({ telefone, mensagem, tipo, quando: new Date().toISOString() });
  escreverJSON(ARQ_ALERTAS, lista);
}

function limparAlertas() {
  escreverJSON(ARQ_ALERTAS, []);
}

// Sessões por telefone: pra Carla não "esquecer" uma conversa em andamento se o bot reiniciar.
function lerSessoes() {
  return lerJSON(ARQ_SESSOES, {});
}

function obterSessao(telefone) {
  const sessoes = lerSessoes();
  return sessoes[telefone] || null;
}

function salvarSessao(telefone, sessao) {
  const sessoes = lerSessoes();
  sessoes[telefone] = sessao;
  escreverJSON(ARQ_SESSOES, sessoes);
}

// Tira o telefone do estado "aguardando humano" pelo painel — útil quando você já resolveu
// por fora e quer que a Carla volte a responder esse número sozinha antes das 2h automáticas.
function retomarAtendimento(telefone) {
  const sessao = obterSessao(telefone);
  if (!sessao) return false;
  sessao.aguardandoHumano = false;
  sessao.aguardandoHumanoDesde = null;
  salvarSessao(telefone, sessao);
  return true;
}

// Apaga a sessão inteira desse telefone (histórico, aguardando humano, último agendamento
// lembrado etc) — a próxima mensagem desse número é tratada como se fosse a primeira vez.
function limparConversa(telefone) {
  const sessoes = lerSessoes();
  delete sessoes[telefone];
  escreverJSON(ARQ_SESSOES, sessoes);
}

// Últimos contatos pro painel: um por telefone, ordenado do mais recente pro mais antigo.
// Só entra quem já tem "ultimaAtividade" registrada (server.js carimba isso a cada
// mensagem processada) — sessões antigas sem esse campo simplesmente não aparecem.
function listarContatosRecentes(limite = 20) {
  const sessoes = lerSessoes();
  return Object.entries(sessoes)
    .filter(([, s]) => s && s.ultimaAtividade)
    .map(([telefone, s]) => ({
      telefone,
      ultimaAtividade: s.ultimaAtividade,
      ultimaMensagem: s.ultimaMensagem || "",
      fechou: !!s.ultimoAgendamento,
      aguardandoHumano: !!s.aguardandoHumano,
    }))
    .sort((a, b) => new Date(b.ultimaAtividade) - new Date(a.ultimaAtividade))
    .slice(0, limite);
}

// Contatos conhecidos do WhatsApp. Guarda dois nomes bem diferentes:
// - nomeSalvo: como o Dr. Bruno salvou esse número na agenda do celular dele. Só existe
//   quando o WhatsApp sincroniza os contatos do telefone — e é justamente esse o sinal de
//   que a pessoa já é paciente (ele só salva o nome depois que alguém já passou com ele).
// - pushName: o nome que a PRÓPRIA pessoa escolheu no perfil dela do WhatsApp — qualquer
//   um tem isso, não indica paciente nenhum, é só um apelido de exibição.
// Alimentado pela sincronização de histórico ao conectar, por atualização de contatos, e por
// toda mensagem vista (enviada ou recebida). É só informativo — nunca decide sozinho quem a
// Carla responde ou não, mas o nomeSalvo alimenta o tom de conversa (ver cerebro-ia.js).
function lerContatosWhatsappMapa() {
  return lerJSON(ARQ_CONTATOS_WHATSAPP, {});
}

function registrarContatoWhatsapp(telefone, { nomeSalvo, pushName } = {}) {
  const contatos = lerContatosWhatsappMapa();
  const atual = contatos[telefone] || { nomeSalvo: null, pushName: null };
  const novo = {
    nomeSalvo: nomeSalvo || atual.nomeSalvo || null,
    pushName: pushName || atual.pushName || null,
  };
  if (novo.nomeSalvo === atual.nomeSalvo && novo.pushName === atual.pushName) return; // nada novo
  contatos[telefone] = novo;
  escreverJSON(ARQ_CONTATOS_WHATSAPP, contatos);
}

// Pacientes marcados manualmente pelo painel — cobre o caso do sinal automático (nome salvo
// no WhatsApp) não ter pego ainda (a sincronização de contatos nem sempre roda de novo numa
// reconexão comum, só na primeira vez que conecta). Some diretamente na decisão de tom da
// Carla, igual o nomeSalvo — ver ehPacienteConhecido.
function lerPacientesManuais() {
  return lerJSON(ARQ_PACIENTES_MANUAIS, []);
}

function marcarPacienteManual(telefone) {
  const lista = lerPacientesManuais();
  if (!lista.includes(telefone)) lista.push(telefone);
  escreverJSON(ARQ_PACIENTES_MANUAIS, lista);
  return lista;
}

function desmarcarPacienteManual(telefone) {
  const lista = lerPacientesManuais().filter((t) => t !== telefone);
  escreverJSON(ARQ_PACIENTES_MANUAIS, lista);
  return lista;
}

// true quando o telefone está salvo com nome na agenda do celular do Dr. Bruno (sinal
// automático) OU foi marcado manualmente como paciente pelo painel — qualquer um dos dois
// já ajusta o tom de abordagem da Carla (ver cerebro-ia.js).
function ehPacienteConhecido(telefone) {
  const contato = lerContatosWhatsappMapa()[telefone];
  if (contato && contato.nomeSalvo) return true;
  return lerPacientesManuais().includes(telefone);
}

// Lista única pro painel: todo contato que a Carla já viu no WhatsApp (mais quem foi marcado
// manualmente como paciente, mesmo sem nunca ter aparecido ainda), cruzado com a sessão
// (última atividade, se fechou consulta, se está aguardando humano) e com o estado de
// silenciado — assim dá pra ver, silenciar e marcar paciente num só lugar, com rolagem.
function listarTodosContatos() {
  const contatosWhatsapp = lerContatosWhatsappMapa();
  const sessoes = lerSessoes();
  const silenciados = new Set(lerContatosSilenciados());
  const pacientesManuais = new Set(lerPacientesManuais());
  const telefones = new Set([...Object.keys(contatosWhatsapp), ...pacientesManuais]);
  const lista = [...telefones].map((telefone) => {
    const info = contatosWhatsapp[telefone] || {};
    const sessao = sessoes[telefone];
    const marcadoManualmente = pacientesManuais.has(telefone);
    return {
      telefone,
      nome: info.nomeSalvo || info.pushName || null,
      contatoSalvo: !!info.nomeSalvo || marcadoManualmente,
      marcadoManualmente,
      ultimaAtividade: (sessao && sessao.ultimaAtividade) || null,
      ultimaMensagem: (sessao && sessao.ultimaMensagem) || "",
      fechou: !!(sessao && sessao.ultimoAgendamento),
      aguardandoHumano: !!(sessao && sessao.aguardandoHumano),
      silenciado: silenciados.has(telefone),
    };
  });
  lista.sort((a, b) => {
    if (a.ultimaAtividade && b.ultimaAtividade) return new Date(b.ultimaAtividade) - new Date(a.ultimaAtividade);
    if (a.ultimaAtividade) return -1;
    if (b.ultimaAtividade) return 1;
    return (a.nome || a.telefone).localeCompare(b.nome || b.telefone);
  });
  return lista;
}

// Taxa de conversão simples: quantos telefones que já falaram com a Carla (contatos únicos
// com sessão registrada) resultaram em pelo menos um agendamento de verdade.
function metricasConversao() {
  const sessoes = lerSessoes();
  const totalContatos = Object.keys(sessoes).length;
  const telefonesComAgendamento = new Set(lerAgendamentos().map((a) => a.telefone));
  const totalFechados = telefonesComAgendamento.size;
  const taxa = totalContatos === 0 ? 0 : Math.round((totalFechados / totalContatos) * 100);
  return { totalContatos, totalFechados, taxa };
}

// Números que o Dr. Bruno silenciou manualmente pelo painel (família, amigos, pacientes
// que ele já atende por fora etc) — a Carla nunca responde esses números, mas isso nunca
// tem prioridade sobre a checagem de emergência (ver server.js: emergência sempre primeiro).
function lerContatosSilenciados() {
  return lerJSON(ARQ_SILENCIADOS, []);
}

function contatoSilenciado(telefone) {
  return lerContatosSilenciados().includes(telefone);
}

function silenciarContato(telefone) {
  const lista = lerContatosSilenciados();
  if (!lista.includes(telefone)) lista.push(telefone);
  escreverJSON(ARQ_SILENCIADOS, lista);
  return lista;
}

function dessilenciarContato(telefone) {
  const lista = lerContatosSilenciados().filter((t) => t !== telefone);
  escreverJSON(ARQ_SILENCIADOS, lista);
  return lista;
}

module.exports = {
  lerAgendamentos, idsOcupados, reservar, cancelarAgendamento, definirAppAgendamentoId, lerAlertas, registrarAlertaUrgencia,
  limparAlertas, formatarDataBR, obterSessao, salvarSessao,
  agendamentosProntosParaLembrete, marcarLembreteEnviado,
  lerBloqueios, alternarBloqueioDia,
  lerBloqueiosHorarios, alternarBloqueioHorario, listarHorariosDoDia,
  listarContatosRecentes, metricasConversao,
  lerContatosSilenciados, contatoSilenciado, silenciarContato, dessilenciarContato,
  registrarContatoWhatsapp, listarTodosContatos, ehPacienteConhecido,
  lerPacientesManuais, marcarPacienteManual, desmarcarPacienteManual,
  retomarAtendimento, limparConversa,
};
