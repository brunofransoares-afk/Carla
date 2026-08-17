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
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");

require(path.join(__dirname, "..", "carla-app", "js", "config.js"));
const Agenda = require(path.join(__dirname, "..", "carla-app", "js", "agenda.js"));
const Storage = require(path.join(__dirname, "storage-node.js"));
const CerebroIA = require(path.join(__dirname, "cerebro-ia.js"));
const Avisos = require(path.join(__dirname, "avisos-texto.js"));
const Previa = require(path.join(__dirname, "previa-de-link.js"));
const Comprovante = require(path.join(__dirname, "comprovante-de-pagamento.js"));

const ATRASO_RESPOSTA_MS = 3000;
const PORTA_TRAVA = 3357;
const HORA_LEMBRETES = 8; // manda os lembretes automáticos a partir das 8h
const AGUARDANDO_HUMANO_EXPIRA_MS = 2 * 60 * 60 * 1000; // 2 horas

// Avisa a família que o guia foi liberado. Espelha o avisarPortalLiberado de propósito —
// mesmas travas, mesma ordem — porque as duas mensagens falham do mesmo jeito.
//
// UMA DIFERENÇA QUE IMPORTA: o guia é um produto pago. Esta mensagem só sai por um toque do
// Dr. Bruno, DEPOIS de ele já ter liberado o acesso no prontuário. A Carla nunca oferece o
// guia por conta própria e nunca manda este link sozinha — a instrução dela no cerebro-ia
// diz isso explicitamente.
async function avisarGuiaLiberado({ telefone, email }) {
  const endereco = (process.env.GUIA_URL || "").trim();
  const agendamento = telefone
    ? [...Storage.lerAgendamentos()].reverse().find((a) => a.telefone === telefone)
    : Storage.acharAgendamentoPorEmail(email);
  // Já avisado vem ANTES das travas: repetir é o defeito a evitar, e não faz sentido
  // recusar por falta de e-mail uma mensagem que já foi enviada.
  if (agendamento && agendamento.guiaAvisadoEm) return { ok: true, jaAvisado: true };

  const porta = Avisos.checarAviso({ endereco: endereco, nomeDaVariavel: "GUIA_URL",
    conectado: !!sockAtivo, agendamento: agendamento, email: email });
  if (!porta.ok) return porta;

  const jid = agendamento.telefone.replace("+", "") + "@s.whatsapp.net";
  const texto = Avisos.textoGuia({ endereco: endereco, email: porta.email });

  await sockAtivo.sendMessage(jid, Previa.mensagemDeTexto(texto));
  Storage.marcarGuiaAvisado(agendamento.slotId);
  console.log(`[GUIA] Avisei ${agendamento.telefone} sobre o guia de ${agendamento.crianca}`);
  return { ok: true };
}

// Avisa a família que o portal da criança foi liberado, com o link. Só o bot pode fazer
// isso: a conexão do WhatsApp vive aqui, o painel é outro processo e não tem acesso a ela.
// Por isso a rota interna existe — é o painel repassando pra cá o toque que o Dr. Bruno
// deu no prontuário.
//
// Inerte sem PORTAL_URL: sem o endereço não há o que mandar, e mandar meia mensagem
// ("seu portal está liberado!" sem link) seria pior que não mandar nada.
// A mensagem que a família recebe quando o Dr. Bruno marca a consulta como paga. É o único
// momento em que a palavra "confirmada" pode ser usada: até aqui o horário estava só
// separado, e quem viu o dinheiro no extrato foi ele.
//
// Não passa pela IA de propósito. É texto fixo, escrito uma vez, sobre um fato que o
// sistema conhece com certeza. Botar a IA pra redigir isso seria dar a ela a chance de
// escrever "confirmado" errado, ou de inventar detalhe, justamente na mensagem que a
// família vai guardar pra saber quando e onde é a consulta.
// Só o primeiro nome, e SEM artigo: "a consulta de Isis", nunca "da Isis" ou "do Isis".
//
// A primeira versão disto chutava o gênero pela terminação e escrevia "do Isis" e "do Lis".
// Adivinhar sexo por nome é justamente o que o prompt proíbe a Carla de fazer, e eu fui
// fazer no código — onde é pior, porque aqui não tem a conversa pra dar pista nenhuma.
// "de Fulano" é sempre certo, pra qualquer nome, e não soa artificial.
function primeiroNome(nome) {
  return String(nome || "").trim().split(/\s+/)[0] || "";
}

async function avisarPagamentoConfirmado(slotId) {
  if (!slotId) return { ok: false, motivo: "Sem slotId." };
  const a = Storage.acharAgendamentoPorSlot(slotId);
  if (!a) return { ok: false, motivo: `Não achei agendamento com slotId ${slotId}.` };
  // O botão do painel é um interruptor, e clique repetido acontece. Sem esta trava a
  // família receberia a mesma confirmação duas vezes.
  if (a.pagamentoAvisadoEm) return { ok: true, jaAvisado: true };
  if (!sockAtivo) return { ok: false, motivo: "Carla desconectada do WhatsApp." };
  if (!String(a.telefone || "").startsWith("+")) return { ok: false, motivo: "Sem telefone de WhatsApp." };

  const jid = a.telefone.replace("+", "") + "@s.whatsapp.net";

  // O e-mail e a data de nascimento são pedidos AQUI, e não junto da reserva, porque este é
  // o melhor momento da conversa inteira pra pedir: a família acabou de pagar, está
  // comprometida e satisfeita. Antes, isso ia na mensagem da reserva, que ficava com cinco
  // assuntos — e a família respondia um e esquecia o resto, quase sempre o e-mail.
  //
  // Cada dado só é pedido se ainda faltar. O e-mail é do responsável e serve pra qualquer
  // filho; a data é da criança e nunca serve pra outra. Como isto é código e não IA, a
  // conferência é certa: ela não pergunta de novo o que já está guardado.
  const falta = [];
  if (!a.responsavelEmail) falta.push("seu *e-mail*");
  if (!a.criancaDataNascimento) falta.push(`a data de nascimento de ${primeiroNome(a.crianca)}`);

  const pedido = falta.length === 0 ? "" : `\n\nMe manda ${falta.join(" e ")}?\n\n${
    a.responsavelEmail && !a.criancaDataNascimento
      ? `É pra montar a curva de crescimento de ${primeiroNome(a.crianca)} no portal.`
      : `É pra criar o portal de ${primeiroNome(a.crianca)}: um espaço só de vocês, onde você guarda os exames, a carteira de vacinação e o peso e altura, e compara os exames antigos com os novos. As receitas e os documentos que o Dr. Bruno passar também ficam lá, junto com o crescimento e as vacinas que ainda faltam.`
  }`;

  const texto = `Pagamento recebido! 😊\n\nA consulta de ${primeiroNome(a.crianca)} está confirmada para ${a.diaLabel}.\n\nEndereço: Rua Ranulpho Alvarenga Ferreira, 61${pedido}\n\nQualquer coisa até lá, é só me chamar por aqui.`;

  await sockAtivo.sendMessage(jid, Previa.mensagemDeTexto(texto));
  Storage.marcarPagamentoAvisado(slotId);
  console.log(`[PAGAMENTO] Avisei ${a.telefone} que a consulta de ${a.crianca} está confirmada`);
  return { ok: true };
}

async function avisarPortalLiberado({ telefone, email }) {
  const endereco = (process.env.PORTAL_URL || "").trim();
  const agendamento = telefone
    ? [...Storage.lerAgendamentos()].reverse().find((a) => a.telefone === telefone)
    : Storage.acharAgendamentoPorEmail(email);
  if (agendamento && agendamento.portalAvisadoEm) return { ok: true, jaAvisado: true };

  // Mesmas travas do guia, e uma delas é NOVA aqui: a falta de e-mail. Antes o portal não
  // checava, e o texto interpola o endereço direto — sem e-mail a família recebia a linha
  // "usando este mesmo e-mail: undefined". Prometer acesso com endereço em branco é pior
  // que não mandar: quem lê tenta, não consegue, e conclui que o portal não funciona.
  const porta = Avisos.checarAviso({ endereco: endereco, nomeDaVariavel: "PORTAL_URL",
    conectado: !!sockAtivo, agendamento: agendamento, email: email });
  if (!porta.ok) return porta;

  const jid = agendamento.telefone.replace("+", "") + "@s.whatsapp.net";
  const texto = Avisos.textoPortal({ endereco: endereco, crianca: agendamento.crianca,
    email: porta.email });

  await sockAtivo.sendMessage(jid, Previa.mensagemDeTexto(texto));
  Storage.marcarPortalAvisado(agendamento.slotId);
  console.log(`[PORTAL] Avisei ${agendamento.telefone} sobre o portal de ${agendamento.crianca}`);
  return { ok: true };
}

// Não serve mais o painel (isso agora é o processo separado painel-server.js, que fica
// de pé mesmo com o bot desligado). Aqui sobrou a trava de instância única: se essa porta
// já estiver ocupada, é sinal de que já existe uma Carla rodando, então encerra em vez de
// deixar duas instâncias brigarem pela mesma conexão do WhatsApp.
function iniciarTravaInstancia() {
  const servidor = http.createServer((req, res) => {
    // Além da trava, esta porta é a caixa de entrada interna do bot: o painel repassa
    // pra cá o que precisa da conexão do WhatsApp. Só escuta em 127.0.0.1 (ver listen
    // no fim desta função), então nada da internet chega aqui direto.
    if (req.method === "POST" && req.url === "/interno/guia-liberado") {
      let corpo = "";
      req.on("data", (p) => { corpo += p; });
      req.on("end", async () => {
        let dados = {};
        try { dados = JSON.parse(corpo || "{}"); } catch { /* corpo inválido vira busca vazia */ }
        try {
          const r = await avisarGuiaLiberado({ telefone: dados.telefone, email: dados.email });
          res.writeHead(r.ok ? 200 : 422, { "Content-Type": "application/json" });
          res.end(JSON.stringify(r));
        } catch (erro) {
          console.error("[GUIA] Erro ao avisar:", erro.message);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, motivo: erro.message }));
        }
      });
      return;
    }
    // O Dr. Bruno apertou "Pago" no painel. Quem tem a conexão do WhatsApp é este
    // processo, então o painel encaminha pra cá.
    if (req.method === "POST" && req.url === "/interno/pagamento-confirmado") {
      let corpo = "";
      req.on("data", (p) => { corpo += p; });
      req.on("end", async () => {
        let dados = {};
        try { dados = JSON.parse(corpo || "{}"); } catch { /* corpo inválido vira busca vazia */ }
        try {
          const r = await avisarPagamentoConfirmado(dados.slotId);
          res.writeHead(r.ok ? 200 : 422, { "Content-Type": "application/json" });
          res.end(JSON.stringify(r));
        } catch (erro) {
          console.error("[PAGAMENTO] Erro ao avisar a família:", erro.message);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, motivo: erro.message }));
        }
      });
      return;
    }
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
    if (req.method === "POST" && req.url === "/interno/resposta-do-doutor") {
      let corpo = "";
      req.on("data", (p) => { corpo += p; });
      req.on("end", async () => {
        let dados = {};
        try { dados = JSON.parse(corpo || "{}"); } catch { /* corpo inválido vira busca vazia */ }
        try {
          const r = await responderEscalada(dados.alertaId, dados.resposta);
          res.writeHead(r.ok ? 200 : 422, { "Content-Type": "application/json" });
          res.end(JSON.stringify(r));
        } catch (erro) {
          console.error("[RESPOSTA DO DOUTOR] Erro:", erro.message);
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
  return { telefone, historico: [], aguardandoHumano: false, aguardandoHumanoDesde: null, recadoDoDoutor: null };
}

async function enviarResposta(sock, jid, telefone, texto, semAtraso) {
  if (!semAtraso) {
    await sock.presenceSubscribe(jid).catch(() => {});
    await sock.sendPresenceUpdate("composing", jid).catch(() => {});
    await new Promise((r) => setTimeout(r, ATRASO_RESPOSTA_MS));
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});
  }
  try {
    await sock.sendMessage(jid, Previa.mensagemDeTexto(texto));
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
    await sock.sendMessage(jid, Previa.mensagemDeTexto(texto));
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
    await sock.sendMessage(jid, Previa.mensagemDeTexto(linhas.join("\n")));
  } catch (erro) {
    console.error("[NOTIFICAÇÃO] Erro ao avisar os dados do paciente:", erro.message);
  }
}

// Chama o Dr. Bruno no WhatsApp quando a conversa precisa dele: emergência ou escalonamento.
//
// Isto faltava, e a falta era pior na emergência: a mensagem que a família recebe promete
// "vou avisar o Dr. Bruno sobre esse contato assim que possível", e ninguém era avisado. O
// alerta ficava parado no painel esperando alguém abrir. Agendamento novo e dados do portal
// já chamavam por ele desde sempre; os dois casos que mais precisam dele, não.
//
// Mesmo desenho das outras duas: inerte sem DR_BRUNO_TELEFONE, nunca aguardada, e o erro
// morre aqui dentro. Avisar o Dr. Bruno nunca pode atrapalhar a resposta pra família.
async function notificarAtencao(sock, { tipo, telefoneFamilia, texto, crianca, pergunta }) {
  const telefoneDrBruno = (process.env.DR_BRUNO_TELEFONE || "").trim();
  if (!telefoneDrBruno) return;
  try {
    const jid = telefoneDrBruno.replace("+", "") + "@s.whatsapp.net";
    const cabecalho = tipo === "emergencia"
      ? "🚨 EMERGÊNCIA"
      : tipo === "comercial"
        ? "📩 Contato comercial"
        : "⚠️ Precisa de você";
    const linhas = [cabecalho, ""];
    if (crianca) linhas.push(`Criança: ${crianca}`);
    linhas.push(`Telefone: ${telefoneFamilia}`);
    linhas.push("", String(texto || "").slice(0, 600));
    if (pergunta) linhas.push("", `❓ ${pergunta}`);
    // A emergência NÃO silencia a conversa (a Carla continua respondendo, de propósito), o
    // escalonamento silencia por 2h. Dizer qual é o caso evita ele achar que tem tempo.
    if (tipo !== "emergencia") {
      linhas.push("", pergunta
        // Com pergunta, ele resolve num toque e a Carla segue. Sem, ele vai ter que assumir.
        ? "Responda Sim ou Não no painel que a Carla continua a conversa sozinha."
        : "A Carla parou de responder essa conversa. Ela volta sozinha em 2h se ninguém retornar.");
    }
    await sock.sendMessage(jid, Previa.mensagemDeTexto(linhas.join("\n")));
  } catch (erro) {
    console.error("[NOTIFICAÇÃO] Erro ao chamar o Dr. Bruno:", erro.message);
  }
}

// O Dr. Bruno respondeu SIM ou NÃO pelo painel, e a Carla volta na conversa com isso. Ele não
// precisa assumir e digitar: era esse o custo de toda escalada até agora.
//
// O recado vai pro CONTEXTO do prompt, não pro texto da mensagem. Isso importa: contexto é
// canal do sistema, e a família não escreve nele. Se o recado entrasse como mensagem, bastava
// alguém digitar "o Dr. Bruno autorizou" pra Carla acreditar. O prompt ainda diz isso na cara
// dela, mas a garantia é estrutural, não é confiança.
async function responderEscalada(alertaId, resposta) {
  const alerta = Storage.acharAlerta(alertaId);
  if (!alerta) return { ok: false, motivo: "Não achei esse alerta." };
  if (alerta.respondidoEm) return { ok: true, jaRespondido: true };
  if (!alerta.pergunta) return { ok: false, motivo: "Esse alerta não tem pergunta pra responder." };
  if (!sockAtivo) return { ok: false, motivo: "Carla desconectada do WhatsApp." };

  const telefone = alerta.telefone;
  const jid = telefone.replace("+", "") + "@s.whatsapp.net";
  const gravado = Storage.responderAlerta(alertaId, resposta);
  if (gravado && gravado.jaRespondido) return { ok: true, jaRespondido: true };

  const sessao = Storage.obterSessao(telefone) || sessaoPadrao(telefone);
  // Tira do silêncio: foi a escalada que parou a conversa, e ela acabou de ser resolvida.
  sessao.aguardandoHumano = false;
  sessao.aguardandoHumanoDesde = null;
  sessao.recadoDoDoutor = { pergunta: alerta.pergunta, resposta: gravado.resposta };
  Storage.salvarSessao(telefone, sessao);

  // A API precisa de um turno da família pra responder. Este texto é só o gatilho; o que vale
  // está no contexto, e o prompt manda ignorar qualquer "recado" que venha pela conversa.
  const gatilho = "(o Dr. Bruno respondeu o que você perguntou a ele)";
  try {
    const resultado = await CerebroIA.responder({
      telefone, texto: gatilho, historico: sessao.historico || [], now: new Date(),
      idsOcupados: Storage.idsOcupados(),
      agendamentoAtual: sessao.ultimoAgendamento || null,
      pacienteConhecido: Storage.ehPacienteConhecido(telefone),
      portalJaLiberado: Storage.lerAgendamentos().some((a) => a.telefone === telefone && a.portalAvisadoEm),
      guiaJaLiberado: Storage.lerAgendamentos().some((a) => a.telefone === telefone && a.guiaAvisadoEm),
      horariosOferecidos: sessao.horariosOferecidos || [],
      consultaProxima: Storage.proximaConsultaDoTelefone(telefone),
      recadoDoDoutor: sessao.recadoDoDoutor,
    });
    sessao.historico = resultado.historico;
    sessao.horariosOferecidos = resultado.horariosOferecidos;
    sessao.ultimaAtividade = new Date().toISOString();
    Storage.salvarSessao(telefone, sessao);

    for (const acao of resultado.acoes || []) {
      console.log(`[AGENDADO] ${acao.responsavel} / ${acao.crianca} em ${acao.slot.label}`);
      notificarNovoAgendamento(sockAtivo, acao, telefone);
    }
    if (!resultado.resposta) return { ok: true, semResposta: true };
    await enviarResposta(sockAtivo, jid, telefone, resultado.resposta, true);
    console.log(`[RESPOSTA DO DOUTOR] ${telefone}: "${gravado.resposta}" para "${alerta.pergunta}"`);
    return { ok: true };
  } catch (erro) {
    console.error("[RESPOSTA DO DOUTOR] Erro ao retomar a conversa:", erro.message);
    return { ok: false, motivo: erro.message };
  }
}

async function processarMensagem(sock, jid, telefone, texto, { semAtraso = false } = {}) {
  const sessao = Storage.obterSessao(telefone) || sessaoPadrao(telefone);
  const now = new Date();

  // Depois de horas de silêncio, o que a família disser é assunto novo. Sem isso a Carla
  // continuava a conversa da tarde à noite: retomou um "Pix ou cartão?" de outra consulta
  // e confirmou agendamento com o nome da criança errada, lido do histórico velho.
  if (Storage.historicoExpirou(sessao, now)) {
    console.log(`[SESSÃO] ${telefone}: silêncio longo desde ${sessao.ultimaAtividade} — conversa recomeça do zero`);
    sessao.historico = [];
    // Os horários oferecidos morrem com a conversa: eram de outro assunto, e a agenda
    // pode ter mudado desde então.
    sessao.horariosOferecidos = [];
    // O recado do Dr. Bruno era sobre aquela conversa. Numa conversa nova ele não vale mais.
    sessao.recadoDoDoutor = null;
  }

  // 1) Emergência sempre primeiro, sempre determinística — nunca passa pela IA.
  if (CerebroIA.pareceEmergencia(texto)) {
    Storage.registrarAlertaUrgencia({ telefone, mensagem: texto, tipo: "emergencia" });
    console.log(`[ALERTA: URGÊNCIA] ${telefone}: "${texto}"`);
    // Antes de responder a família, pra já estar a caminho. Não é aguardada.
    notificarAtencao(sock, { tipo: "emergencia", telefoneFamilia: telefone, texto });
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

  // 1.7) Comprovante de pagamento: silêncio. Quem confirma pagamento é o Dr. Bruno, no
  // botão "Pago" do painel, e aquele botão já dispara a mensagem que confirma a consulta e
  // pede o e-mail e a data de nascimento que faltam. Quando a Carla respondia por conta
  // própria, ela pedia as mesmas duas coisas e a família recebia o pedido duas vezes.
  //
  // Fica DEPOIS da emergência de propósito: comprovante junto de "meu filho está
  // convulsionando" ainda é emergência, e a regra 1 é inegociável.
  //
  // Não entra no histórico de propósito. Se a Carla lesse o comprovante numa mensagem
  // seguinte, ela teria material pra comentar o pagamento por conta própria, que é
  // exatamente o que esta regra existe pra impedir. O painel do Dr. Bruno continua
  // mostrando a mensagem (ultimaMensagem, logo abaixo), que é onde ele precisa ver.
  if (Comprovante.pareceComprovante(texto)) {
    console.log(`[COMPROVANTE] ${telefone}: recebido, silêncio — quem confirma é o botão do painel`);
    sessao.ultimaAtividade = now.toISOString();
    sessao.ultimaMensagem = texto.slice(0, 140);
    Storage.salvarSessao(telefone, sessao);
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

  // Antes de a IA rodar, porque ela vai escrever no histórico e aí não dá mais pra saber.
  const ehPrimeiraMensagemDaConversa = (sessao.historico || []).length === 0;

  const idsOcupados = Storage.idsOcupados();
  const resultado = await CerebroIA.responder({
    telefone, texto, historico: sessao.historico || [], now, idsOcupados,
    agendamentoAtual: sessao.ultimoAgendamento || null,
    pacienteConhecido: Storage.ehPacienteConhecido(telefone),
    // Se ela precisa dizer, NESTA mensagem, que é o atendimento automático.
    //
    // Vale pra todo mundo menos quem o painel mostra como Paciente: quem está salvo na agenda
    // do Dr. Bruno ou foi marcado no botão. Esses ele já conhece pessoalmente, e anunciar
    // automação pra eles seria estranho.
    //
    // Uma vez por número, pra sempre. Quem já marcou consulta com ela continua recebendo o
    // cumprimento curto de sempre, só que da primeira vez com essa frase junto. Sem o "uma
    // vez" ela reapresentaria o consultório inteiro pra família que tem consulta amanhã, que
    // é um defeito que já aconteceu aqui (ver ehPacienteConhecido em storage-node.js).
    precisaSeApresentar: ehPrimeiraMensagemDaConversa
      && !Storage.ehPacienteNoPainel(telefone)
      && !Storage.jaSeApresentou(telefone),
    // Vale enquanto a conversa durar: ela pode precisar dele de novo na mensagem seguinte.
    recadoDoDoutor: sessao.recadoDoDoutor || null,
    // Sem isso a Carla continua dizendo que o Dr. Bruno "vai liberar mais perto da
    // consulta" DEPOIS de ela mesma ter mandado o link. O prompt é montado antes de ela
    // ver o histórico, então quem sabe disso é o código, não ela.
    portalJaLiberado: Storage.lerAgendamentos().some((a) => a.telefone === telefone && a.portalAvisadoEm),
    guiaJaLiberado: Storage.lerAgendamentos().some((a) => a.telefone === telefone && a.guiaAvisadoEm),
    // Os horários que ela já ofereceu nesta conversa. É o que a trava do
    // confirmar_agendamento usa pra recusar horário que ela não mostrou pra família.
    horariosOferecidos: sessao.horariosOferecidos || [],
    // A consulta que ainda vai acontecer nesse telefone, lida da agenda de verdade. Sem
    // isso a Carla trata quem tem consulta hoje como contato novo, porque o histórico da
    // conversa de ontem já expirou.
    consultaProxima: (() => {
      const c = Storage.proximaConsultaDoTelefone(telefone, now);
      return c ? { crianca: c.crianca, diaLabel: c.diaLabel, ehHoje: c.data === Agenda.toDateStr(now) } : null;
    })(),
  });

  sessao.historico = resultado.historico;
  sessao.horariosOferecidos = resultado.horariosOferecidos || [];

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
    Storage.registrarAlertaUrgencia({
      telefone, mensagem: resultado.escalar, tipo: tipoAlerta,
      pergunta: resultado.escalarPergunta,
      dataPedida: resultado.escalarData,
      horaPedida: resultado.escalarHora,
    });
    console.log(`[ALERTA: ESCALADO PELA IA] ${telefone}: "${resultado.escalar}"`);
    notificarAtencao(sock, {
      tipo: resultado.escalarTipo === "comercial" ? "comercial" : "escalonamento",
      telefoneFamilia: telefone,
      texto: resultado.escalar,
      crianca: sessao.ultimoAgendamento && sessao.ultimoAgendamento.crianca,
      pergunta: resultado.escalarPergunta,
    });
  }

  sessao.ultimaAtividade = now.toISOString();
  sessao.ultimaMensagem = texto.slice(0, 140);
  Storage.salvarSessao(telefone, sessao);

  if (!resultado.resposta) {
    console.log(`[SILÊNCIO PROPOSITAL] ${telefone} — sem necessidade de responder agora.`);
    return;
  }

  await enviarResposta(sock, jid, telefone, resultado.resposta, semAtraso);

  // Só depois de a mensagem sair de verdade. Marcar antes faria o número perder a
  // apresentação por causa de uma falha de envio, e ele nunca mais ouviria.
  if (ehPrimeiraMensagemDaConversa && Storage.marcarApresentacao(telefone)) {
    console.log(`[APRESENTAÇÃO] ${telefone}: soube que a Carla é o atendimento automático`);
  }
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
      await sock.sendMessage(jid, Previa.mensagemDeTexto(texto));
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
      await sock.sendMessage(jid, Previa.mensagemDeTexto(texto));
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
  // O WhatsApp rejeita versões antigas do protocolo antes mesmo de gerar o QR. A versão
  // embutida no pacote pode ficar defasada sem haver uma nova publicação no npm, então
  // consulta a versão mantida pelo próprio Baileys a cada nova conexão.
  const { version, isLatest, error: erroVersao } = await fetchLatestBaileysVersion();
  if (isLatest) {
    console.log(`[WHATSAPP] Usando versão de protocolo ${version.join(".")}.`);
  } else {
    console.warn(`[WHATSAPP] Não consegui consultar a versão atual; usando ${version.join(".")}: ${erroVersao?.message || "erro desconhecido"}`);
  }

  const sock = makeWASocket({
    auth: state,
    version,
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
