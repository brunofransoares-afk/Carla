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
const ARQ_NAO_PACIENTES_MANUAIS = path.join(DIR_DADOS, "nao-pacientes-manuais.json");
const ARQ_HORARIOS_EXTRAS = path.join(DIR_DADOS, "horarios-extras.json");
const ARQ_DADOS_PENDENTES = path.join(DIR_DADOS, "dados-pendentes.json");

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
    : slotsPossiveisComExtras(now).filter((s) => bloqueios.has(s.date)).map((s) => s.id);
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

// HORÁRIOS EXTRAS — horários liberados na mão pelo painel, fora da grade padrão do
// consultório (ex: uma sexta à tarde). Ficam guardados como {data, hora} e viram slots
// no mesmo formato dos da grade, pra todo o resto do sistema tratar igual: a Carla pode
// oferecer e confirmar, e o painel pode bloquear/remover.
function lerHorariosExtras() {
  return lerJSON(ARQ_HORARIOS_EXTRAS, []);
}

// Monta um slot no mesmo formato dos gerados pela grade padrão ({id, date, time, label}).
// O id leva o prefixo "extra-" pra nunca colidir com um id da grade.
function slotDeExtra({ data, hora }) {
  const [ano, mes, dia] = data.split("-").map(Number);
  const nomesDia = (global.CARLA_CONFIG && global.CARLA_CONFIG.nomesDiaSemana) || [];
  const nomeDia = nomesDia[new Date(ano, mes - 1, dia).getDay()] || "";
  const horaLabel = typeof Agenda.formatHora === "function" ? Agenda.formatHora(hora) : hora;
  return {
    id: `extra-${data}-${hora}`,
    date: data,
    time: hora,
    label: `${nomeDia} (${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}) às ${horaLabel}`,
    extra: true,
  };
}

// Slots extras que ainda fazem sentido oferecer: só os que não passaram. Ordenados no
// tempo. Não filtra ocupado/bloqueado — quem chama cuida disso (igual à grade padrão).
function listarSlotsExtras(now = new Date()) {
  return lerHorariosExtras()
    .map(slotDeExtra)
    .filter((s) => {
      const [ano, mes, dia] = s.date.split("-").map(Number);
      const [h, m] = s.time.split(":").map(Number);
      return new Date(ano, mes - 1, dia, h, m) > now;
    })
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

// A grade padrão MAIS os horários extras — é o que o resto do sistema deve usar como
// "todos os horários que existem", pra um extra poder ser oferecido e confirmado igual
// a qualquer outro.
function slotsPossiveisComExtras(now = new Date()) {
  return [...Agenda.gerarSlotsPossiveis(now), ...listarSlotsExtras(now)];
}

// Extras realmente livres pra oferecer: tira os já ocupados/bloqueados e, quando pedido,
// filtra por dia da semana, período ou data específica (mesmos critérios da grade).
function extrasDisponiveis(now = new Date(), ocupados = new Set(), filtros = {}) {
  const { diaPreferido = null, periodo = null, dataPreferida = null } = filtros;
  const bloqueados = new Set(lerBloqueios());
  return listarSlotsExtras(now).filter((s) => {
    if (ocupados.has(s.id)) return false;
    if (bloqueados.has(s.date)) return false;
    if (dataPreferida && s.date !== dataPreferida) return false;
    if (diaPreferido !== null) {
      const [ano, mes, dia] = s.date.split("-").map(Number);
      if (new Date(ano, mes - 1, dia).getDay() !== diaPreferido) return false;
    }
    if (periodo) {
      const hora = Number(s.time.split(":")[0]);
      if (periodo === "manha" && hora >= 12) return false;
      if (periodo === "tarde" && hora < 12) return false;
    }
    return true;
  });
}

function adicionarHorarioExtra(data, hora) {
  const lista = lerHorariosExtras();
  if (!lista.some((e) => e.data === data && e.hora === hora)) {
    lista.push({ data, hora });
  }
  escreverJSON(ARQ_HORARIOS_EXTRAS, lista);
  return lista;
}

function removerHorarioExtra(slotId) {
  const lista = lerHorariosExtras().filter((e) => `extra-${e.data}-${e.hora}` !== slotId);
  escreverJSON(ARQ_HORARIOS_EXTRAS, lista);
  return lista;
}

// Todos os horários de um dia específico, já cruzados com agendamento real, bloqueio do
// dia inteiro e bloqueio individual — pro painel mostrar e deixar bloquear um por um.
// Inclui os horários extras liberados na mão pra esse dia.
function listarHorariosDoDia(dataStr, now = new Date()) {
  const agendamentos = lerAgendamentos();
  const diaTodoBloqueado = lerBloqueios().includes(dataStr);
  const bloqueiosHorarios = new Set(lerBloqueiosHorarios());
  const horarios = slotsPossiveisComExtras(now)
    .filter((s) => s.date === dataStr)
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((s) => {
      const agendamento = agendamentos.find((a) => a.slotId === s.id);
      return {
        slotId: s.id,
        time: s.time,
        ocupado: !!agendamento,
        responsavel: agendamento ? agendamento.responsavel : null,
        crianca: agendamento ? agendamento.crianca : null,
        bloqueado: diaTodoBloqueado || bloqueiosHorarios.has(s.id),
        extra: !!s.extra,
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
    // As duas últimas colunas costumam vir vazias: só são preenchidas quando a família
    // passa os dados depois da confirmação, e passar é opcional. Ficam no fim de
    // propósito, pra ordem das colunas antigas não mudar pra quem já usa esse arquivo.
    ["Nome do responsável", "Nome da criança", "Telefone", "Data da consulta", "Horário", "Registrado em", "E-mail do responsável", "Nascimento da criança", "Pago"],
    ...lista.map((a) => [
      a.responsavel, a.crianca, a.telefone, formatarDataBR(a.data), a.horario,
      new Date(a.registradoEm).toLocaleString("pt-BR"),
      a.responsavelEmail || "", a.criancaDataNascimento ? formatarDataBR(a.criancaDataNascimento) : "",
      a.pago ? "sim" : "não",
    ]),
  ];
  const csv = linhas.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  fs.writeFileSync(ARQ_AGENDAMENTOS_CSV, "﻿" + csv, "utf8");
}

// E-mail do responsável e data de nascimento da criança que a família mandou ANTES de
// existir um agendamento pra ligar. Acontece o tempo todo: a Carla pede o nome do
// responsável e da criança, e a família emenda a data de nascimento na mesma mensagem,
// antes de escolher horário. Sem este bolso o dado sumia — e a Carla ainda respondia
// "anotado". Fica guardado por telefone até a reserva acontecer, e é consumido lá.
function guardarDadosPendentes(telefone, { email = null, dataNascimento = null } = {}) {
  const todos = lerJSON(ARQ_DADOS_PENDENTES, {});
  const atual = todos[telefone] || {};
  if (email) atual.email = email;
  if (dataNascimento) atual.dataNascimento = dataNascimento;
  atual.registradoEm = new Date().toISOString();
  todos[telefone] = atual;
  escreverJSON(ARQ_DADOS_PENDENTES, todos);
}

function lerDadosPendentes(telefone) {
  return lerJSON(ARQ_DADOS_PENDENTES, {})[telefone] || null;
}

function limparDadosPendentes(telefone) {
  const todos = lerJSON(ARQ_DADOS_PENDENTES, {});
  if (!todos[telefone]) return;
  delete todos[telefone];
  escreverJSON(ARQ_DADOS_PENDENTES, todos);
}

// Retorna false se o horário já tiver sido reservado por outra família (nunca deixa
// duplicar). Quando dá certo devolve o agendamento criado, porque quem chama precisa
// saber se veio e-mail/nascimento junto (do bolso de pendentes) pra mandar pro prontuário.
function reservar({ slot, responsavel, crianca, telefone, googleEventId = null }) {
  const lista = lerAgendamentos();
  if (lista.some((a) => a.slotId === slot.id)) return false;
  // O que a família adiantou antes de ter horário entra aqui, no agendamento certo.
  const pendentes = lerDadosPendentes(telefone);
  const item = {
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
    responsavelEmail: (pendentes && pendentes.email) || null,
    criancaDataNascimento: (pendentes && pendentes.dataNascimento) || null,
    // Reservar não confirma mais nada: quem confirma é o pagamento (ver
    // prazo-de-pagamento.js). Nasce false e só o Dr. Bruno vira, pelo painel, porque não
    // existe integração que avise que o Pix caiu.
    pago: false,
  };
  lista.push(item);
  escreverJSON(ARQ_AGENDAMENTOS, lista);
  reescreverCSV(lista);
  if (pendentes) limparDadosPendentes(telefone);
  return item;
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

// Guarda e-mail do responsável e data de nascimento da criança no agendamento mais
// recente desse telefone. É o que vai alimentar a criação do portal da criança no
// Sistema Pediátrico Integrado.
//
// Devolve o AGENDAMENTO (não só `true`) porque quem chama precisa do appAgendamentoId pra
// mandar esses dados pro prontuário, e é aqui que se sabe em qual agendamento eles
// entraram. Continua devolvendo `false` quando não há agendamento pra ligar, então um
// `if (!guardado)` do lado de quem chama segue valendo.
function registrarDadosDoPaciente(telefone, { email = null, dataNascimento = null } = {}) {
  const lista = lerAgendamentos();
  // O mais recente primeiro: uma família pode ter marcado pra dois filhos, e os dados
  // pertencem ao agendamento que acabou de ser feito.
  const item = [...lista].reverse().find((a) => a.telefone === telefone);
  // Sem agendamento ainda: guarda no bolso de pendentes em vez de perder o dado. O
  // `pendente: true` avisa quem chamou que não há o que mandar pro prontuário AGORA —
  // isso acontece na reserva, quando o agendamento finalmente existe.
  if (!item) {
    guardarDadosPendentes(telefone, { email, dataNascimento });
    return { pendente: true };
  }
  // Nada de novo: a Carla reviu a conversa, achou o e-mail que ELA MESMA escreveu numa
  // mensagem anterior e chamou a ferramenta de novo com o mesmo dado. Gravar de novo não
  // faz mal, mas quem chama dispara um WhatsApp pro Dr. Bruno a cada gravação — e ele
  // recebia o mesmo aviso duas vezes. Aqui a repetição morre, no código, sem depender do
  // modelo perceber que já tinha feito isso.
  const emailNovo = !!email && email !== item.responsavelEmail;
  const dataNova = !!dataNascimento && dataNascimento !== item.criancaDataNascimento;
  if (!emailNovo && !dataNova) return { semNovidade: true, agendamento: item };

  if (emailNovo) item.responsavelEmail = email;
  if (dataNova) item.criancaDataNascimento = dataNascimento;
  escreverJSON(ARQ_AGENDAMENTOS, lista);
  reescreverCSV(lista);
  return item;
}

// Acha o agendamento mais recente de um e-mail de responsável. É como o prontuário
// identifica a família quando avisa que o portal foi liberado: lá ele conhece o e-mail,
// não o telefone do WhatsApp. Comparação em minúsculas e sem espaços dos dois lados,
// porque o e-mail foi digitado à mão numa conversa.
function acharAgendamentoPorEmail(email) {
  const alvo = String(email || "").trim().toLowerCase();
  if (!alvo) return null;
  const lista = lerAgendamentos();
  return [...lista].reverse().find((a) => String(a.responsavelEmail || "").trim().toLowerCase() === alvo) || null;
}

// Marca que a família já foi avisada do portal, pra um segundo toque no botão do
// prontuário não render uma segunda mensagem igual pra ela.
// Liga e desliga o "pago" de um agendamento. Só o Dr. Bruno mexe nisso, pelo painel: não
// existe integração que avise quando o Pix cai, então a única fonte de verdade é ele
// olhando o extrato. Desligar tem que funcionar igual a ligar, porque errar a linha do
// clique é o tipo de coisa que acontece no celular.
// Guarda a cobrança criada na InfinitePay junto do agendamento. O slug pode vir null: no
// link que a API devolve o identificador vem no parâmetro lenc, não no caminho. O que
// amarra o pagamento à consulta é o slotId, que vai no order_nsu.
function guardarCobranca(slotId, { url, slug = null }) {
  const lista = lerAgendamentos();
  const item = lista.find((a) => a.slotId === slotId);
  if (!item) return false;
  item.cobranca = { url, slug, criadaEm: new Date().toISOString() };
  escreverJSON(ARQ_AGENDAMENTOS, lista);
  return true;
}

// As consultas que ainda não foram pagas e que ainda vão acontecer. É o que a conferência
// periódica pergunta à InfinitePay. Consulta que já passou fica de fora: cobrar depois do
// atendimento não é problema deste laço.
function agendamentosPendentesDePagamento(now = new Date()) {
  const hoje = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return lerAgendamentos().filter((a) => {
    if (a.pago) return false;
    if (!a.cobranca || !a.cobranca.url) return false;
    const [ano, mes, dia] = String(a.data).split("-").map(Number);
    return new Date(ano, mes - 1, dia) >= hoje;
  });
}

function marcarPagamento(slotId, pago, detalhes = null) {
  const lista = lerAgendamentos();
  const item = lista.find((a) => a.slotId === slotId);
  if (!item) return false;
  item.pago = !!pago;
  item.pagoEm = item.pago ? new Date().toISOString() : null;
  item.pagamento = item.pago && detalhes ? detalhes : null;
  escreverJSON(ARQ_AGENDAMENTOS, lista);
  reescreverCSV(lista);
  return true;
}

function marcarPortalAvisado(slotId) {
  const lista = lerAgendamentos();
  const item = lista.find((a) => a.slotId === slotId);
  if (!item) return false;
  item.portalAvisadoEm = new Date().toISOString();
  escreverJSON(ARQ_AGENDAMENTOS, lista);
  return true;
}

// Mesma coisa para o guia. Marca separada da do portal de propósito: são dois envios
// independentes, e a família pode receber um sem o outro (o portal é do consultório, o
// guia é um produto). Uma marca só faria o segundo botão sumir junto com o primeiro.
function marcarGuiaAvisado(slotId) {
  const lista = lerAgendamentos();
  const item = lista.find((a) => a.slotId === slotId);
  if (!item) return false;
  item.guiaAvisadoEm = new Date().toISOString();
  escreverJSON(ARQ_AGENDAMENTOS, lista);
  return true;
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

// Quanto tempo de silêncio faz uma conversa deixar de ser "a mesma conversa". Pausa de
// verdade num atendimento é de minutos; quem volta horas depois está começando outro
// assunto, e continuar de onde parou dá erro grave — ver historicoExpirou.
const CONVERSA_EXPIRA_MS = 4 * 60 * 60 * 1000; // 4 horas

// O histórico guardava as últimas 24 mensagens SEM olhar quando foram. Uma família que
// falou às 14h e voltou às 21h recebia a Carla continuando o assunto da tarde: ela
// retomou um "Pix ou cartão?" pendente de outra consulta e, pior, confirmou agendamento
// com o nome da criança ERRADA, lido do histórico velho em vez da conversa de agora.
// Devolve true quando o histórico precisa ser descartado antes de responder.
function historicoExpirou(sessao, now = new Date()) {
  if (!sessao || !sessao.historico || !sessao.historico.length) return false;
  if (!sessao.ultimaAtividade) return false;
  const ultima = new Date(sessao.ultimaAtividade).getTime();
  if (Number.isNaN(ultima)) return false;
  return now.getTime() - ultima > CONVERSA_EXPIRA_MS;
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

// Lista de telefones que o painel forçou a NÃO ser paciente, mesmo estando salvos com nome
// na agenda do celular. Sobrepõe a detecção automática por nomeSalvo — assim dá pra fazer a
// Carla tratar de novo como lead novo (primeira vez) alguém que ela detectaria como conhecido.
function lerNaoPacientesManuais() {
  return lerJSON(ARQ_NAO_PACIENTES_MANUAIS, []);
}

// Marca como paciente: tira da lista de "não-paciente" (se estava) e, se não for um contato
// já salvo com nome, adiciona na lista de pacientes manuais. Sempre resulta em paciente.
function marcarPacienteManual(telefone) {
  const naoPacientes = lerNaoPacientesManuais().filter((t) => t !== telefone);
  escreverJSON(ARQ_NAO_PACIENTES_MANUAIS, naoPacientes);
  const lista = lerPacientesManuais();
  if (!lista.includes(telefone)) lista.push(telefone);
  escreverJSON(ARQ_PACIENTES_MANUAIS, lista);
  return lista;
}

// Remove a marcação de paciente: tira da lista de pacientes manuais E adiciona na lista de
// "não-paciente" (que sobrepõe o nomeSalvo). Sempre resulta em não-paciente, mesmo pra quem
// estava salvo com nome na agenda.
function desmarcarPacienteManual(telefone) {
  const lista = lerPacientesManuais().filter((t) => t !== telefone);
  escreverJSON(ARQ_PACIENTES_MANUAIS, lista);
  const naoPacientes = lerNaoPacientesManuais();
  if (!naoPacientes.includes(telefone)) naoPacientes.push(telefone);
  escreverJSON(ARQ_NAO_PACIENTES_MANUAIS, naoPacientes);
  return lista;
}

// true quando o telefone está salvo com nome na agenda do celular do Dr. Bruno (sinal
// automático) OU foi marcado manualmente como paciente pelo painel — qualquer um dos dois
// já ajusta o tom de abordagem da Carla (ver cerebro-ia.js). A lista de "não-paciente"
// (forçada pelo painel) sobrepõe tudo isso, sempre.
function ehPacienteConhecido(telefone) {
  if (lerNaoPacientesManuais().includes(telefone)) return false;
  const contato = lerContatosWhatsappMapa()[telefone];
  if (contato && contato.nomeSalvo) return true;
  if (lerPacientesManuais().includes(telefone)) return true;
  // Quem marcou consulta com a Carla não é desconhecido, mesmo que o número não esteja
  // salvo na agenda do celular. Sem isto ela se reapresenta ("Aqui é a Carla, secretária
  // do Dr. Bruno...") pra família que ela mesma atendeu ontem — e chegou a fazer isso 27
  // minutos depois de mandar o lembrete da consulta daquele dia.
  return lerAgendamentos().some((a) => a.telefone === telefone);
}

// A consulta mais próxima que ainda vai acontecer nesse telefone (a de hoje conta o dia
// todo). É o que permite a Carla responder "a consulta do Pedro é hoje às 9h30" em vez de
// perguntar como pode ajudar, pra quem ela lembrou de manhã.
function proximaConsultaDoTelefone(telefone, now = new Date()) {
  const hoje = Agenda.toDateStr(now);
  return lerAgendamentos()
    .filter((a) => a.telefone === telefone && a.data >= hoje)
    .sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario))[0] || null;
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
  const naoPacientes = new Set(lerNaoPacientesManuais());
  const telefones = new Set([...Object.keys(contatosWhatsapp), ...pacientesManuais]);
  const lista = [...telefones].map((telefone) => {
    const info = contatosWhatsapp[telefone] || {};
    const sessao = sessoes[telefone];
    const marcadoManualmente = pacientesManuais.has(telefone);
    // Estado efetivo de paciente (o mesmo que a Carla usa): "não-paciente" forçado sobrepõe
    // tudo; senão, é paciente se estiver salvo com nome ou marcado manualmente.
    const ehPaciente = naoPacientes.has(telefone) ? false : (!!info.nomeSalvo || marcadoManualmente);
    return {
      telefone,
      nome: info.nomeSalvo || info.pushName || null,
      ehPaciente,
      contatoSalvo: ehPaciente,
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
  registrarDadosDoPaciente, guardarDadosPendentes, lerDadosPendentes, limparDadosPendentes,
  acharAgendamentoPorEmail, marcarPortalAvisado, marcarGuiaAvisado, marcarPagamento, guardarCobranca, agendamentosPendentesDePagamento, historicoExpirou, proximaConsultaDoTelefone,
  lerAgendamentos, idsOcupados, reservar, cancelarAgendamento, definirAppAgendamentoId, lerAlertas, registrarAlertaUrgencia,
  limparAlertas, formatarDataBR, obterSessao, salvarSessao,
  agendamentosProntosParaLembrete, marcarLembreteEnviado,
  lerBloqueios, alternarBloqueioDia,
  lerBloqueiosHorarios, alternarBloqueioHorario, listarHorariosDoDia,
  lerHorariosExtras, adicionarHorarioExtra, removerHorarioExtra,
  listarSlotsExtras, slotsPossiveisComExtras, extrasDisponiveis,
  listarContatosRecentes, metricasConversao,
  lerContatosSilenciados, contatoSilenciado, silenciarContato, dessilenciarContato,
  registrarContatoWhatsapp, listarTodosContatos, ehPacienteConhecido,
  lerPacientesManuais, lerNaoPacientesManuais, marcarPacienteManual, desmarcarPacienteManual,
  retomarAtendimento, limparConversa,
};
