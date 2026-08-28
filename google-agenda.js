// Integração com o Google Agenda: a Carla consulta e cria eventos direto na agenda que a
// Onmed também usa, pra nunca oferecer ou confirmar um horário que já esteja ocupado por
// qualquer coisa (consulta marcada pela Onmed, compromisso pessoal etc.) — não só o que
// está no nosso próprio arquivo de agendamentos. Se não estiver configurado (sem credencial
// ou sem GOOGLE_CALENDAR_ID no .env), esse módulo fica inerte e o bot segue só com a
// checagem local, como sempre funcionou.

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const CAMINHO_CREDENCIAIS = path.join(__dirname, "google-credenciais.json");

let clienteCalendar = null;

function calendarId() {
  return process.env.GOOGLE_CALENDAR_ID || null;
}

function disponivel() {
  return !!calendarId() && fs.existsSync(CAMINHO_CREDENCIAIS);
}

function obterCliente() {
  if (!disponivel()) return null;
  if (!clienteCalendar) {
    const auth = new google.auth.GoogleAuth({
      keyFile: CAMINHO_CREDENCIAIS,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    clienteCalendar = google.calendar({ version: "v3", auth });
  }
  return clienteCalendar;
}

// true = livre, false = ocupado, null = não deu pra checar (integração indisponível ou erro;
// o chamador deve seguir só com a checagem local nesse caso, nunca travar por causa disso).
async function estaLivre(inicio, fim) {
  const calendar = obterCliente();
  if (!calendar) return null;
  try {
    const resposta = await calendar.freebusy.query({
      requestBody: {
        timeMin: inicio.toISOString(),
        timeMax: fim.toISOString(),
        items: [{ id: calendarId() }],
      },
    });
    const ocupados = resposta.data.calendars?.[calendarId()]?.busy || [];
    return ocupados.length === 0;
  } catch (erro) {
    console.error("[GOOGLE AGENDA] Erro ao consultar disponibilidade:", erro.message);
    return null;
  }
}

// As versões estritas propagam erros para a caixa durável. Um eventId determinístico torna
// a criação idempotente: repetir a mesma operação não cria dois eventos no Google.
async function criarEventoEstrito({ inicio, fim, titulo, descricao, eventId }) {
  const calendar = obterCliente();
  if (!calendar) throw new Error("Integração com Google Agenda não configurada.");
  try {
    const resposta = await calendar.events.insert({
      calendarId: calendarId(),
      requestBody: {
        id: eventId || undefined,
        summary: titulo,
        description: descricao,
        start: { dateTime: inicio.toISOString(), timeZone: "America/Sao_Paulo" },
        end: { dateTime: fim.toISOString(), timeZone: "America/Sao_Paulo" },
      },
    });
    return resposta.data.id || eventId || null;
  } catch (erro) {
    // O ID determinístico já existe: uma tentativa anterior funcionou, mas a Carla caiu
    // antes de registrar o sucesso. Para a reconciliação isso já é sucesso.
    if (Number(erro.code || erro.response?.status) === 409 && eventId) return eventId;
    throw erro;
  }
}

// Cria o evento de verdade na agenda. Retorna o id do evento criado, ou null se a integração
// não estiver disponível ou a criação falhar (nesse caso o agendamento local já feito continua
// valendo — a falha aqui não desfaz a reserva).
async function criarEvento(dados) {
  if (!obterCliente()) return null;
  try {
    return await criarEventoEstrito(dados);
  } catch (erro) {
    console.error("[GOOGLE AGENDA] Erro ao criar evento:", erro.message);
    return null;
  }
}

// Cancela um evento pelo id. Chamado quando um agendamento é apagado pelo painel — sem
// isso, o horário ficaria bloqueado pra sempre na agenda mesmo depois de cancelado aqui.
async function cancelarEventoEstrito(eventId) {
  const calendar = obterCliente();
  if (!calendar) throw new Error("Integração com Google Agenda não configurada.");
  if (!eventId) throw new Error("eventId é obrigatório para cancelar no Google Agenda.");
  try {
    await calendar.events.delete({ calendarId: calendarId(), eventId });
    return true;
  } catch (erro) {
    // Excluir de novo é sucesso idempotente: o resultado desejado (evento ausente) já vale.
    if ([404, 410].includes(Number(erro.code || erro.response?.status))) return true;
    throw erro;
  }
}

async function cancelarEvento(eventId) {
  if (!obterCliente() || !eventId) return false;
  try {
    return await cancelarEventoEstrito(eventId);
  } catch (erro) {
    console.error("[GOOGLE AGENDA] Erro ao cancelar evento:", erro.message);
    return false;
  }
}

module.exports = {
  disponivel,
  estaLivre,
  criarEvento,
  cancelarEvento,
  criarEventoEstrito,
  cancelarEventoEstrito,
};
