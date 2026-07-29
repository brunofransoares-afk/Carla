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
// Avisa a família que o portal da criança foi liberado, com o link. Só o bot pode fazer
// isso: a conexão do WhatsApp vive aqui, o painel é outro processo e não tem acesso a ela.
// Por isso a rota interna abaixo existe — é o painel repassando pra cá o toque que o
// Dr. Bruno deu no prontuário.
//
// Inerte sem PORTAL_URL: sem o endereço não há o que mandar, e mandar meia mensagem
// ("seu portal está liberado!" sem link) seria pior que não mandar nada.
async function avisarPortalLiberado({ telefone, email }) {
  const endereco = (process.env.PORTAL_URL || "").trim();
  if (!endereco) return { ok: false, motivo: "PORTAL_URL não configurada" };
  if (!sockAtivo) return { ok: false, motivo: "Carla desconectada do WhatsApp" };

  const agendamento = telefone
    ? [...Storage.lerAgendamentos()].reverse().find((a) => a.telefone === telefone)
    : Storage.acharAgendamentoPorEmail(email);
  if (!agendamento) return { ok: false, motivo: "Não achei agendamento pra esse telefone/e-mail" };
  if (agendamento.portalAvisadoEm) return { ok: true, jaAvisado: true };

  // Só telefone em formato internacional recebe mensagem — igual aos lembretes. Os
  // placeholders tipo "(a confirmar)" de agendamento feito na mão não são um WhatsApp.
  if (!String(agendamento.telefone || "").startsWith("+")) {
    return { ok: false, motivo: "Agendamento sem telefone de WhatsApp válido" };
  }

  const jid = agendamento.telefone.replace("+", "") + "@s.whatsapp.net";
  const texto = [
    // Sem "dela"/"dele" e sem "da"/"do": este texto é fixo e o sistema não sabe o sexo da
    // criança (quem infere isso é o prontuário, pelo primeiro nome, e nem sempre acerta).
    // Escrito no neutro, serve pros dois e nunca sai errado na cara da família.
    `Oi! O Dr. Bruno liberou o portal de ${agendamento.crianca} 😊`,
    "",
    "É onde fica tudo num lugar só: você guarda os exames, a carteira de vacinação e o peso e altura, e compara os exames antigos com os novos. As receitas e os documentos que o Dr. Bruno passar chegam por lá também, e você acompanha o crescimento e as vacinas que ainda faltam.",
    "",
    endereco,
    "",
    `No primeiro acesso você cria a sua senha, usando este mesmo e-mail: ${agendamento.responsavelEmail || email}`,
    "",
    // O passo a passo muda entre iPhone e Android, e a família não vai saber qual é o
    // "menu do navegador" se ninguém disser. Uma linha pra cada, sem virar tutorial.
    "Se quiser deixar como aplicativo no celular: abra o link, toque no menu do navegador e escolha \"Adicionar à Tela de Início\". No iPhone o menu é o ícone de compartilhar; no Android, os três pontinhos.",
  ].join("\n");

  await sockAtivo.sendMessage(jid, { text: texto });
  Storage.marcarPortalAvisado(agendamento.slotId);
  console.log(`[PORTAL] Avisei ${agendamento.telefone} sobre o portal de ${agendamento.crianca}`);
  return { ok: true };
}

function iniciarTravaInstancia() {
  const servidor = http.createServer((req, res) => {
    // Além da trava, esta porta é a caixa de entrada interna do bot: o painel repassa
    // pra cá o que precisa da conexão do WhatsApp. Só escuta em 127.0.0.1 (ver listen
    // no fim desta função), então nada da internet chega aqui direto.
    if (req.method === "POST" && req.url === "/interno/portal-liberado") {
      let corpo = "";
      req.on("data", (p) => { corpo += p; });
      req.on("end", async () => {
        let dados = {};
        try { dados = JSON.parse(corpo || "{}"); } catch { /* corpo inválido vira busca vazia */ }
        try {
          const r = await avisarPortalLiberado({ telefone: dados.telefone, email: dados.email });
          res.writeHead(r.ok ? 200 : 422, { "Content-Type": "application/json" });
          res.end(JSON.stringify(r));
        } catch (erro) {
          console.error("[PORTAL] Erro ao avisar:", erro.message);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, motivo: erro.message }));
        }
      });
      return;
    }
    res.end("ok");
  });

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

// O WhatsApp pode reentregar a mesma mensagem depois de uma reconexão (ex: instabilidade de
// rede) — se isso acontecer fora da janela do debounce acima, viraria um segundo
// processamento completo da mesma mensagem, gerando uma resposta duplicada e confusa (a IA
// vendo a mesma pergunta "de novo" já com a primeira resposta no histórico). Guarda o ID de
// cada mensagem já vista por um tempo pra nunca processar a mesma duas vezes.
const DEDUP_JANELA_MS = 10 * 60 * 1000;
const idsMensagensVistas = new Map(); // msg.key.id -> timestamp de quando foi vista

function jaProcessouMensagem(id) {
  if (!id) return false;
  const agora = Date.now();
  for (const [msgId, vistoEm] of idsMensagensVistas) {
    if (agora - vistoEm > DEDUP_JANELA_MS) idsMensagensVistas.delete(msgId);
  }
  if (idsMensagensVistas.has(id)) return true;
  idsMensagensVistas.set(id, agora);
  return false;
}

function normalizarTelefone(jid) {
  return "+" + jid.split("@")[0];
}

// Quando o contato vem como "@lid" (id interno do WhatsApp), o Baileys costuma informar o
// JID real (com o número de telefone) em remoteJidAlt — prioriza ele. Sem isso, cai num
// pseudo-telefone "lid:..." só pra ter uma chave estável (não é um número de verdade).
function telefoneDoJid(jid, remoteJidAlt) {
  const jidComTelefone = remoteJidAlt?.endsWith("@s.whatsapp.net")
    ? remoteJidAlt
    : (jid.endsWith("@s.whatsapp.net") ? jid : null);
  return jidComTelefone ? normalizarTelefone(jidComTelefone) : `lid:${jid.split("@")[0]}`;
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

// Áudio (mensagem de voz ou arquivo de áudio) — a Carla ainda não consegue ouvir, então só
// pede, de forma fixa e educada, pra mandar por escrito. Sempre determinístico, nunca passa
// pela IA. Respeita silêncio manual e atendimento humano em andamento, igual mensagem de texto.
const PEDIDO_MANDAR_POR_ESCRITO = "Oi 😊 Por aqui eu ainda não consigo ouvir áudio. Poderia me mandar por escrito, por favor? Assim consigo te ajudar certinho.";

async function processarAudioRecebido(sock, jid, telefone) {
  if (Storage.contatoSilenciado(telefone)) return;
  const sessao = Storage.obterSessao(telefone);
  if (sessao && sessao.aguardandoHumano) return;
  await enviarResposta(sock, jid, telefone, PEDIDO_MANDAR_POR_ESCRITO, false);
}

// Avisa o Dr. Bruno por WhatsApp (mensagem de verdade, não notificação de navegador — mais
// confiável) toda vez que a Carla confirma um agendamento novo. Inerte sem DR_BRUNO_TELEFONE
// configurado no .env. Nunca é aguardada por quem chama — não pode atrasar a resposta pra família.
async function notificarNovoAgendamento(sock, acao, telefoneFamilia) {
  const telefoneDrBruno = (process.env.DR_BRUNO_TELEFONE || "").trim();
  if (!telefoneDrBruno) return;
  try {
    const jid = telefoneDrBruno.replace("+", "") + "@s.whatsapp.net";
    const texto = `Novo agendamento pela Carla 📅\n\nCriança: ${acao.crianca}\nResponsável: ${acao.responsavel}\nTelefone: ${telefoneFamilia}\nQuando: ${acao.slot.label}`;
    await sock.sendMessage(jid, { text: texto });
  } catch (erro) {
    console.error("[NOTIFICAÇÃO] Erro ao avisar o Dr. Bruno:", erro.message);
  }
}

// Segundo aviso, quando a família passa e-mail e data de nascimento. Vem separado do
// aviso de agendamento de propósito: esses dados chegam depois, numa mensagem seguinte, e
// é neste momento que dá pra criar o portal da criança e liberar a cortesia do guia.
// Inerte sem DR_BRUNO_TELEFONE. Nunca é aguardada.
async function notificarDadosDoPaciente(sock, dados, acao, telefoneFamilia) {
  const telefoneDrBruno = (process.env.DR_BRUNO_TELEFONE || "").trim();
  if (!telefoneDrBruno) return;
  if (!dados || (!dados.email && !dados.dataNascimento)) return;
  try {
    const jid = telefoneDrBruno.replace("+", "") + "@s.whatsapp.net";
    const linhas = ["Dados pro portal 📁", ""];
    if (acao && acao.crianca) linhas.push(`Criança: ${acao.crianca}`);
    linhas.push(`Telefone: ${telefoneFamilia}`);
    if (dados.email) linhas.push(`E-mail: ${dados.email}`);
    if (dados.dataNascimento) linhas.push(`Nascimento: ${dados.dataNascimento}`);
    await sock.sendMessage(jid, { text: linhas.join("\n") });
  } catch (erro) {
    console.error("[NOTIFICAÇÃO] Erro ao avisar os dados do paciente:", erro.message);
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
    sessao.ultimaAtividade = now.toISOString();
    sessao.ultimaMensagem = texto.slice(0, 140);
    Storage.salvarSessao(telefone, sessao);
    await enviarResposta(sock, jid, telefone, respostaEmergencia, semAtraso);
    return;
  }

  // 1.5) Número silenciado manualmente pelo painel (família, amigos, pacientes que o Dr.
  // Bruno já atende por fora etc) — ignora completamente, mas só depois de garantir que
  // não é emergência (regra 1, acima, é inegociável e vale pra qualquer telefone).
  if (Storage.contatoSilenciado(telefone)) {
    console.log(`[IGNORADO — silenciado manualmente] ${telefone}`);
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
    pacienteConhecido: Storage.ehPacienteConhecido(telefone),
  });

  sessao.historico = resultado.historico;

  for (const acao of resultado.acoes || []) {
    console.log(`[AGENDADO] ${acao.responsavel} / ${acao.crianca} em ${acao.slot.label}`);
    sessao.ultimoAgendamento = { crianca: acao.crianca, label: acao.slot.label };
    notificarNovoAgendamento(sock, acao, telefone);
  }

  for (const cancelado of resultado.cancelamentos || []) {
    console.log(`[CANCELADO PELA IA] ${telefone} — ${cancelado.crianca} em ${cancelado.label}`);
  }

  if (resultado.dadosDoPaciente) {
    console.log(`[DADOS DO PORTAL] ${telefone}: ${JSON.stringify(resultado.dadosDoPaciente)}`);
    notificarDadosDoPaciente(sock, resultado.dadosDoPaciente, sessao.ultimoAgendamento, telefone);
  }

  if (resultado.escalar) {
    sessao.aguardandoHumano = true;
    sessao.aguardandoHumanoDesde = now.toISOString();
    // Usa o motivo que a própria IA escreveu (geralmente já inclui nome do responsável e da
    // criança, quando ela colheu isso antes de escalar) em vez da última mensagem crua —
    // é bem mais útil pra você conseguir retornar o contato sabendo do que se trata.
    const tipoAlerta = resultado.escalarTipo === "comercial" ? "comercial" : "nao_entendida";
    Storage.registrarAlertaUrgencia({ telefone, mensagem: resultado.escalar, tipo: tipoAlerta });
    console.log(`[ALERTA: ESCALADO PELA IA] ${telefone}: "${resultado.escalar}"`);
  }

  sessao.ultimaAtividade = now.toISOString();
  sessao.ultimaMensagem = texto.slice(0, 140);
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
    syncFullHistory: true,
  });

  sock.ev.on("creds.update", saveCreds);

  // Preenche a lista de contatos do WhatsApp (pro painel mostrar todo mundo, não só quem já
  // falou com a Carla, e pra Carla saber quem já é paciente salvo na agenda do celular) com
  // o histórico que o WhatsApp manda ao conectar. Só é informativo — nunca bloqueia nem
  // ignora ninguém sozinho, é só pra você conseguir silenciar qualquer contato pelo painel
  // e pra Carla ajustar o tom pra quem já é paciente (ver PACIENTE JÁ CONHECIDO no cerebro-ia.js).
  // Só aceita jid no formato "@s.whatsapp.net" (telefone de verdade) nessas sincronizações —
  // diferente de mensagem recebida em tempo real, aqui não tem um "remoteJidAlt" pra cruzar
  // um "@lid" com o telefone real da mesma pessoa, então aceitar "@lid" cria um contato
  // fantasma duplicado (mesmo nome, sem telefone de verdade, sem nunca ter conversa nenhuma).
  sock.ev.on("messaging-history.set", ({ chats, contacts }) => {
    for (const chat of chats || []) {
      const jid = chat.id || "";
      if (!jid.endsWith("@s.whatsapp.net")) continue;
      Storage.registrarContatoWhatsapp(telefoneDoJid(jid), { nomeSalvo: chat.name || null });
    }
    for (const contato of contacts || []) {
      const jid = contato.id || "";
      if (!jid.endsWith("@s.whatsapp.net")) continue;
      Storage.registrarContatoWhatsapp(telefoneDoJid(jid), { nomeSalvo: contato.name || null, pushName: contato.notify || null });
    }
  });

  // Contatos que passam a ter nome salvo (ou têm o nome atualizado) depois da conexão
  // inicial — sem isso, só descobriríamos "virou paciente" no próximo restart do processo.
  const capturarAtualizacaoContatos = (lista) => {
    for (const contato of lista || []) {
      const jid = contato.id || "";
      if (!jid.endsWith("@s.whatsapp.net")) continue;
      if (!contato.name && !contato.notify) continue;
      Storage.registrarContatoWhatsapp(telefoneDoJid(jid), { nomeSalvo: contato.name || null, pushName: contato.notify || null });
    }
  };
  sock.ev.on("contacts.upsert", capturarAtualizacaoContatos);
  sock.ev.on("contacts.update", capturarAtualizacaoContatos);

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
      if (!msg.message) continue;
      if (jaProcessouMensagem(msg.key.id)) continue;

      const jid = msg.key.remoteJid || "";
      // O WhatsApp mais recente pode identificar o contato por "@lid" (id interno) em vez
      // do número de telefone tradicional ("@s.whatsapp.net"). Aceita os dois; ignora só
      // grupos (@g.us), listas de transmissão e status.
      const ehContatoValido = jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
      if (!ehContatoValido) continue;

      const telefone = telefoneDoJid(jid, msg.key.remoteJidAlt);

      // Mensagem enviada pelo próprio Dr. Bruno (do celular dele) — a Carla nunca responde
      // isso, mas ainda vale registrar o contato na lista do painel (sem nome, já que o
      // pushName aqui seria o dele mesmo, não de quem ele está falando).
      if (msg.key.fromMe) {
        Storage.registrarContatoWhatsapp(telefone, {});
        continue;
      }

      Storage.registrarContatoWhatsapp(telefone, { pushName: msg.pushName || null });

      if (msg.message.audioMessage) {
        processarAudioRecebido(sock, jid, telefone).catch((erro) => {
          console.error("Erro ao processar áudio:", erro.message);
        });
        continue;
      }

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
