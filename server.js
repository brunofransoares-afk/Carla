// Conexão real com o WhatsApp Web. A Claude conduz a conversa inteira (ver cerebro-ia.js),
// mas agenda real, preço e confirmação de agendamento continuam 100% código — ela nunca
// inventa isso sozinha.
//
// IMPORTANTE: isso conecta via WhatsApp Web (não é a WhatsApp Cloud API oficial). Use só
// com um número de teste — o WhatsApp pode bloquear números que ele identifique como
// automação tipo empresa por esse canal não-oficial.

try { process.loadEnvFile(); } catch { /* sem .env ainda — roda normalmente, só sem o reforço de IA */ }

const path = require("path");
const http = require("http");
const qrcode = require("qrcode");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");

require(path.join(__dirname, "..", "carla-app", "js", "config.js"));
const Agenda = require(path.join(__dirname, "..", "carla-app", "js", "agenda.js"));
const Storage = require(path.join(__dirname, "storage-node.js"));
const CerebroIA = require(path.join(__dirname, "cerebro-ia.js"));

const ATRASO_RESPOSTA_MS = 3000;
const PORTA_TRAVA = 3357;
const HORA_LEMBRETES = 8; // manda os lembretes automáticos a partir das 8h
const AGUARDANDO_HUMANO_EXPIRA_MS = 2 * 60 * 60 * 1000; // 2 horas

// Não serve mais o painel (isso agora é o processo separado painel-server.js, que fica
// de pé mesmo com o bot desligado). Aqui só sobrou a trava de instância única: se essa
// porta já estiver ocupada, é sinal de que já existe uma Carla rodando, então encerra
// em vez de deixar duas instâncias brigarem pela mesma conexão do WhatsApp.
function iniciarTravaInstancia() {
  const servidor = http.createServer((req, res) => res.end("ok"));

  servidor.on("error", (erro) => {
    if (erro.code === "EADDRINUSE") {
      console.error(`\nJá existe um processo usando a porta ${PORTA_TRAVA} — provavelmente a Carla já está rodando.`);
      console.error("Confira no painel (http://localhost:3355) ou rode \"npm run status\".\n");
      process.exit(1);
    }
    throw erro;
  });

  servidor.listen(PORTA_TRAVA, "127.0.0.1");
}

// No WhatsApp de verdade é muito comum a pessoa mandar o pensamento picado em várias
// mensagens seguidas ("Boa noite" / "Consulta" / "Meu filho"). Em vez de responder a cada
// uma isoladamente (o que faz a Carla parecer burra, repetindo a mesma pergunta genérica),
// espera um instante de silêncio pra juntar tudo numa mensagem só antes de processar.
const DEBOUNCE_MS = 6000;
const buffers = new Map(); // telefone -> { textos, jid, timer }

function normalizarTelefone(jid) {
  return "+" + jid.split("@")[0];
}

function agendarProcessamento(sock, jid, telefone, texto) {
  let buffer = buffers.get(telefone);
  if (!buffer) {
    buffer = { textos: [], jid, timer: null };
    buffers.set(telefone, buffer);
  }
  buffer.textos.push(texto);
  buffer.jid = jid;

  if (buffer.timer) clearTimeout(buffer.timer);
  buffer.timer = setTimeout(() => {
    const textoCombinado = buffer.textos.join("\n");
    buffers.delete(telefone);
    processarMensagem(sock, buffer.jid, telefone, textoCombinado).catch((erro) => {
      console.error("Erro ao processar mensagem:", erro);
    });
  }, DEBOUNCE_MS);
}

function sessaoPadrao(telefone) {
  return { telefone, historico: [], aguardandoHumano: false, aguardandoHumanoDesde: null };
}

async function enviarResposta(sock, jid, telefone, texto, semAtraso) {
  if (!semAtraso) {
    await sock.presenceSubscribe(jid).catch(() => {});
    await sock.sendPresenceUpdate("composing", jid).catch(() => {});
    await new Promise((r) => setTimeout(r, ATRASO_RESPOSTA_MS));
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});
  }
  try {
    await sock.sendMessage(jid, { text: texto });
    console.log(`[ENVIADA] ${telefone}: ${texto}`);
  } catch (erro) {
    console.error(`[ERRO AO ENVIAR] ${telefone}:`, erro.message);
  }
}

async function processarMensagem(sock, jid, telefone, texto, { semAtraso = false } = {}) {
  const sessao = Storage.obterSessao(telefone) || sessaoPadrao(telefone);
  const now = new Date();

  // 1) Emergência sempre primeiro, sempre determinística — nunca passa pela IA.
  if (CerebroIA.pareceEmergencia(texto)) {
    Storage.registrarAlertaUrgencia({ telefone, mensagem: texto, tipo: "emergencia" });
    console.log(`[ALERTA: URGÊNCIA] ${telefone}: "${texto}"`);
    const respostaEmergencia = "Isso parece ser uma emergência.\n\nPor favor, leve a criança agora para o pronto-socorro mais próximo.\n\nVou avisar o Dr. Bruno sobre esse contato assim que possível.";
    sessao.historico = [...(sessao.historico || []), { role: "user", content: texto }, { role: "assistant", content: respostaEmergencia }].slice(-24);
    sessao.aguardandoHumano = false;
    sessao.aguardandoHumanoDesde = null;
    Storage.salvarSessao(telefone, sessao);
    await enviarResposta(sock, jid, telefone, respostaEmergencia, semAtraso);
    return;
  }

  // 2) Se está aguardando atendimento humano, fica em silêncio — a não ser que já tenha
  // passado tempo suficiente (2h) sem ninguém dar seguimento, aí retoma sozinha.
  if (sessao.aguardandoHumano) {
    const desde = sessao.aguardandoHumanoDesde ? new Date(sessao.aguardandoHumanoDesde) : null;
    const expirou = desde && (now - desde > AGUARDANDO_HUMANO_EXPIRA_MS);
    if (!expirou) {
      console.log(`[SILÊNCIO PROPOSITAL] ${telefone} — aguardando atendimento humano.`);
      return;
    }
    sessao.aguardandoHumano = false;
    sessao.aguardandoHumanoDesde = null;
  }

  const idsOcupados = Storage.idsOcupados();
  const resultado = await CerebroIA.responder({
    telefone, texto, historico: sessao.historico || [], now, idsOcupados,
    agendamentoAtual: sessao.ultimoAgendamento || null,
  });

  sessao.historico = resultado.historico;

  for (const acao of resultado.acoes || []) {
    console.log(`[AGENDADO] ${acao.responsavel} / ${acao.crianca} em ${acao.slot.label}`);
    sessao.ultimoAgendamento = { crianca: acao.crianca, label: acao.slot.label };
  }

  for (const cancelado of resultado.cancelamentos || []) {
    console.log(`[CANCELADO PELA IA] ${telefone} — ${cancelado.crianca} em ${cancelado.label}`);
  }

  if (resultado.escalar) {
    sessao.aguardandoHumano = true;
    sessao.aguardandoHumanoDesde = now.toISOString();
    // Usa o motivo que a própria IA escreveu (geralmente já inclui nome do responsável e da
    // criança, quando ela colheu isso antes de escalar) em vez da última mensagem crua —
    // é bem mais útil pra você conseguir retornar o contato sabendo do que se trata.
    Storage.registrarAlertaUrgencia({ telefone, mensagem: resultado.escalar, tipo: "nao_entendida" });
    console.log(`[ALERTA: ESCALADO PELA IA] ${telefone}: "${resultado.escalar}"`);
  }

  Storage.salvarSessao(telefone, sessao);

  if (!resultado.resposta) {
    console.log(`[SILÊNCIO PROPOSITAL] ${telefone} — sem necessidade de responder agora.`);
    return;
  }

  await enviarResposta(sock, jid, telefone, resultado.resposta, semAtraso);
}

// Lembretes automáticos: aviso 1 semana antes e confirmação no dia da consulta. Só manda
// pra quem tem telefone de verdade salvo (não os "(a confirmar)" ou bloqueios manuais), e
// nunca manda duas vezes o mesmo lembrete pro mesmo agendamento (storage-node.js controla isso).
async function enviarLembretes(sock) {
  const hojeStr = Agenda.toDateStr(new Date());

  for (const a of Storage.agendamentosProntosParaLembrete(hojeStr, "semanaAntes")) {
    const jid = a.telefone.replace("+", "") + "@s.whatsapp.net";
    const texto = `Olá! Passando pra lembrar que a consulta de ${a.crianca} com o Dr. Bruno está agendada para ${a.diaLabel}.\n\nSe precisar remarcar, é só me avisar por aqui 😊`;
    try {
      await sock.sendMessage(jid, { text: texto });
      Storage.marcarLembreteEnviado(a.slotId, "semanaAntes");
      console.log(`[LEMBRETE 1 semana antes] ${a.telefone} — ${a.crianca} em ${a.diaLabel}`);
    } catch (erro) {
      console.error(`[LEMBRETE] Falhou ao avisar ${a.telefone}:`, erro.message);
    }
  }

  for (const a of Storage.agendamentosProntosParaLembrete(hojeStr, "diaDaConsulta")) {
    const jid = a.telefone.replace("+", "") + "@s.whatsapp.net";
    const texto = `Bom dia! Só confirmando: hoje é o dia da consulta de ${a.crianca} com o Dr. Bruno, às ${Agenda.formatHora(a.horario)}.\n\nEndereço: ${CARLA_CONFIG.endereco}\n\nAté já! 😊`;
    try {
      await sock.sendMessage(jid, { text: texto });
      Storage.marcarLembreteEnviado(a.slotId, "diaDaConsulta");
      console.log(`[LEMBRETE dia da consulta] ${a.telefone} — ${a.crianca} às ${a.horario}`);
    } catch (erro) {
      console.error(`[LEMBRETE] Falhou ao avisar ${a.telefone}:`, erro.message);
    }
  }
}

let sockAtivo = null;
let ultimoDiaLembretesEnviados = null;

function checarLembretes() {
  if (!sockAtivo) return;
  const agora = new Date();
  if (agora.getHours() < HORA_LEMBRETES) return;
  const hojeStr = Agenda.toDateStr(agora);
  if (ultimoDiaLembretesEnviados === hojeStr) return;
  ultimoDiaLembretesEnviados = hojeStr;
  enviarLembretes(sockAtivo).catch((erro) => console.error("[LEMBRETE] Erro geral:", erro.message));
}

setInterval(checarLembretes, 15 * 60 * 1000);

// Se o processo for reiniciado (ex: "npm run restart") bem no meio da janela de espera de
// alguém que acabou de mandar mensagem, o buffer em memória seria perdido pra sempre —
// a pessoa mandaria uma mensagem e nunca teria resposta nenhuma. Antes de sair de verdade,
// processa tudo que estiver pendente (sem o atraso artificial de "digitando", pra não
// atrasar ainda mais um desligamento que já está em andamento).
function flushBuffersPendentes() {
  const pendentes = [...buffers.entries()];
  buffers.clear();
  return Promise.all(pendentes.map(([telefone, buffer]) => {
    if (buffer.timer) clearTimeout(buffer.timer);
    if (!sockAtivo) return Promise.resolve();
    const textoCombinado = buffer.textos.join("\n");
    return processarMensagem(sockAtivo, buffer.jid, telefone, textoCombinado, { semAtraso: true })
      .catch((erro) => console.error("[ENCERRANDO] Erro ao esvaziar mensagem pendente:", erro.message));
  }));
}

let encerrando = false;
async function encerrarComCalma(sinal) {
  if (encerrando) return;
  encerrando = true;
  if (buffers.size > 0) {
    console.log(`[${sinal}] Encerrando — respondendo ${buffers.size} mensagem(ns) pendente(s) antes de sair...`);
    await flushBuffersPendentes();
  }
  process.exit(0);
}

process.on("SIGINT", () => encerrarComCalma("SIGINT"));
process.on("SIGTERM", () => encerrarComCalma("SIGTERM"));

async function iniciar() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, "data", "auth"));

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const caminhoQr = path.join(__dirname, "qr.png");
      await qrcode.toFile(caminhoQr, qr, { width: 400 });
      console.log("\nQR code gerado! Abra este arquivo e escaneie com o WhatsApp do celular de teste:");
      console.log(caminhoQr);
      console.log("(No celular: WhatsApp > Configurações > Aparelhos conectados > Conectar um aparelho)\n");
    }

    if (connection === "close") {
      sockAtivo = null;
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const deveReconectar = codigo !== DisconnectReason.loggedOut;
      console.log("Conexão encerrada.", deveReconectar ? "Reconectando..." : "Sessão desconectada — apague a pasta data/auth e rode de novo pra gerar um novo QR code.");
      if (deveReconectar) iniciar();
    } else if (connection === "open") {
      console.log("Carla está conectada e respondendo no WhatsApp!");
      sockAtivo = sock;
      checarLembretes();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid || "";
      // O WhatsApp mais recente pode identificar o contato por "@lid" (id interno) em vez
      // do número de telefone tradicional ("@s.whatsapp.net"). Aceita os dois; ignora só
      // grupos (@g.us), listas de transmissão e status.
      const ehContatoValido = jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
      if (!ehContatoValido) continue;

      // Quando o contato vem como "@lid", o Baileys costuma informar o JID real
      // (com o número de telefone) em remoteJidAlt — prioriza ele pro registro do agendamento.
      const jidComTelefone = msg.key.remoteJidAlt?.endsWith("@s.whatsapp.net")
        ? msg.key.remoteJidAlt
        : (jid.endsWith("@s.whatsapp.net") ? jid : null);
      const telefone = jidComTelefone ? normalizarTelefone(jidComTelefone) : `lid:${jid.split("@")[0]}`;

      const texto = msg.message.conversation
        || msg.message.extendedTextMessage?.text
        || "";
      if (!texto.trim()) continue;

      console.log(`[RECEBIDA] ${telefone} (jid: ${jid}): ${texto}`);
      agendarProcessamento(sock, jid, telefone, texto);
    }
  });
}

iniciarTravaInstancia();
iniciar();
