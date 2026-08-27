// Conexão real com o WhatsApp Web. A Claude conduz a conversa inteira (ver cerebro-ia.js),
// mas agenda real, preço e confirmação de agendamento continuam 100% código — ela nunca
// inventa isso sozinha.
//
// IMPORTANTE: isso conecta via WhatsApp Web (não é a WhatsApp Cloud API oficial). Use só
// com um número de teste — o WhatsApp pode bloquear números que ele identifique como
// automação tipo empresa por esse canal não-oficial.

try { process.loadEnvFile(); } catch { /* sem .env ainda — roda normalmente, só sem o reforço de IA */ }

const path = require("path");
// Instala a redação antes de qualquer integração carregar ou escrever logs. Assim telefone,
// e-mail, texto clínico e segredos não acabam persistidos pelo PM2 em caso de erro.
require(path.join(__dirname, "log-seguro.js")).instalarConsoleSeguro();
const http = require("http");
const qrcode = require("qrcode");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  normalizeMessageContent,
} = require("@whiskeysockets/baileys");

require(path.join(__dirname, "carla-app", "js", "config.js"));
const Agenda = require(path.join(__dirname, "carla-app", "js", "agenda.js"));
const Storage = require(path.join(__dirname, "storage-node.js"));
const CerebroIA = require(path.join(__dirname, "cerebro-ia.js"));
const Avisos = require(path.join(__dirname, "avisos-texto.js"));
const Previa = require(path.join(__dirname, "previa-de-link.js"));
const Comprovante = require(path.join(__dirname, "comprovante-de-pagamento.js"));
const Eventos = require(path.join(__dirname, "registro-de-eventos.js"));
const Reaquecimento = require(path.join(__dirname, "reaquecimento.js"));
const TextoDaMensagem = require(path.join(__dirname, "texto-da-mensagem.js"));
const EstadoAtendimento = require(path.join(__dirname, "estado-atendimento.js"));
const TriagemEmergencia = require(path.join(__dirname, "triagem-emergencia.js"));
const StatusWhatsapp = require(path.join(__dirname, "status-whatsapp.js"));
const { criarFilaPorChave } = require(path.join(__dirname, "fila-por-chave.js"));
const { criarCaixaDeSaida } = require(path.join(__dirname, "caixa-de-saida.js"));
const { criarIntegracoesDuraveis } = require(path.join(__dirname, "integracoes-duraveis.js"));

const ATRASO_RESPOSTA_MS = 3000;
const PORTA_TRAVA = 3357;
const HORA_LEMBRETES = 8; // manda os lembretes automáticos a partir das 8h
const AGUARDANDO_HUMANO_EXPIRA_MS = 2 * 60 * 60 * 1000; // 2 horas
const LIMITE_CORPO_INTERNO_BYTES = 64 * 1024;
const LIMITE_TEXTO_ENTRADA = Math.min(Math.max(Number(process.env.CARLA_MAX_TEXTO_ENTRADA) || 8000, 500), 20000);
const LIMITE_MENSAGENS_POR_MINUTO = Math.min(Math.max(Number(process.env.CARLA_MAX_MENSAGENS_MINUTO) || 30, 5), 120);

const integracoes = criarIntegracoesDuraveis({
  aoVincularAppAgendamento: async (slotId, appAgendamentoId) =>
    Storage.definirAppAgendamentoId(slotId, appAgendamentoId),
  aoVincularGoogleEvento: async (slotId, googleEventId) =>
    Storage.definirGoogleEventId(slotId, googleEventId),
});
const pararReconciliadorIntegracoes = integracoes.iniciarReconciliacao();

// Avisa a família que o guia foi liberado. Espelha o avisarPortalLiberado de propósito —
// mesmas travas, mesma ordem — porque as duas mensagens falham do mesmo jeito.
//
// UMA DIFERENÇA QUE IMPORTA: o guia é um produto pago. Esta mensagem só sai por um toque do
// Dr. Bruno, DEPOIS de ele já ter liberado o acesso no prontuário. A Carla nunca oferece o
// guia por conta própria e nunca manda este link sozinha — a instrução dela no cerebro-ia
// diz isso explicitamente.
async function avisarGuiaLiberado({ telefone, email }) {
  const agendamento = telefone
    ? [...Storage.lerAgendamentos()].reverse().find((a) => a.telefone === telefone)
    : Storage.acharAgendamentoPorEmail(email);
  if (!agendamento) return avisarGuiaLiberadoNaFila({ telefone, email });
  return filaMensagens.enfileirar(agendamento.telefone, () =>
    avisarGuiaLiberadoNaFila({ telefone, email })
  );
}

async function avisarGuiaLiberadoNaFila({ telefone, email }) {
  const endereco = (process.env.GUIA_URL || "").trim();
  const agendamento = telefone
    ? [...Storage.lerAgendamentos()].reverse().find((a) => a.telefone === telefone)
    : Storage.acharAgendamentoPorEmail(email);
  // Já avisado vem ANTES das travas: repetir é o defeito a evitar, e não faz sentido
  // recusar por falta de e-mail uma mensagem que já foi enviada.
  if (agendamento && agendamento.guiaAvisadoEm) return { ok: true, jaAvisado: true };

  const porta = Avisos.checarAviso({ endereco: endereco, nomeDaVariavel: "GUIA_URL",
    // A caixa de saída aceita o aviso mesmo durante uma reconexão e entrega depois.
    conectado: true, agendamento: agendamento, email: email });
  if (!porta.ok) return porta;

  const jid = agendamento.telefone.replace("+", "") + "@s.whatsapp.net";
  const texto = Avisos.textoGuia({ endereco: endereco, email: porta.email });

  await enviarResposta(sockAtivo, jid, agendamento.telefone, texto, true, {
    chaveIdempotencia: `guia:${agendamento.slotId}`,
    efeitoAposEnvio: { tipo: "marcar_guia", slotId: agendamento.slotId },
    registrarNoHistorico: true,
  });
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
  const agendamento = slotId ? Storage.acharAgendamentoPorSlot(slotId) : null;
  if (!agendamento) return avisarPagamentoConfirmadoNaFila(slotId);
  return filaMensagens.enfileirar(agendamento.telefone, () =>
    avisarPagamentoConfirmadoNaFila(slotId)
  );
}

async function avisarPagamentoConfirmadoNaFila(slotId) {
  if (!slotId) return { ok: false, motivo: "Sem slotId." };
  const a = Storage.acharAgendamentoPorSlot(slotId);
  if (!a) return { ok: false, motivo: `Não achei agendamento com slotId ${slotId}.` };
  if (a.estado !== "pago" || !a.pago) {
    return { ok: false, motivo: "Esse agendamento não está marcado como pago." };
  }
  // O botão do painel é um interruptor, e clique repetido acontece. Sem esta trava a
  // família receberia a mesma confirmação duas vezes.
  if (a.pagamentoAvisadoEm) return { ok: true, jaAvisado: true };
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

  // O fato do pagamento vem do painel e vale mesmo se o WhatsApp estiver reconectando.
  // A mensagem fica na caixa de saída, mas a próxima conversa já não pode tratar a consulta
  // como uma mera reserva aguardando Pix.
  registrarPagamentoNaSessao(a.telefone, a);

  await enviarResposta(sockAtivo, jid, a.telefone, texto, true, {
    chaveIdempotencia: `pagamento:${slotId}`,
    efeitoAposEnvio: { tipo: "marcar_pagamento", slotId },
    registrarNoHistorico: true,
  });
  console.log(`[PAGAMENTO] Avisei ${a.telefone} que a consulta de ${a.crianca} está confirmada`);
  return { ok: true };
}

async function avisarPortalLiberado({ telefone, email }) {
  const agendamento = telefone
    ? [...Storage.lerAgendamentos()].reverse().find((a) => a.telefone === telefone)
    : Storage.acharAgendamentoPorEmail(email);
  if (!agendamento) return avisarPortalLiberadoNaFila({ telefone, email });
  return filaMensagens.enfileirar(agendamento.telefone, () =>
    avisarPortalLiberadoNaFila({ telefone, email })
  );
}

async function avisarPortalLiberadoNaFila({ telefone, email }) {
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
    conectado: true, agendamento: agendamento, email: email });
  if (!porta.ok) return porta;

  const jid = agendamento.telefone.replace("+", "") + "@s.whatsapp.net";
  const texto = Avisos.textoPortal({ endereco: endereco, crianca: agendamento.crianca,
    email: porta.email });

  await enviarResposta(sockAtivo, jid, agendamento.telefone, texto, true, {
    chaveIdempotencia: `portal:${agendamento.slotId}`,
    efeitoAposEnvio: { tipo: "marcar_portal", slotId: agendamento.slotId },
    registrarNoHistorico: true,
  });
  console.log(`[PORTAL] Avisei ${agendamento.telefone} sobre o portal de ${agendamento.crianca}`);
  return { ok: true };
}

function lerCorpoJsonInterno(req, res, aoReceber) {
  let corpo = "";
  let bytes = 0;
  let excedeu = false;
  req.on("data", (parte) => {
    bytes += Buffer.byteLength(parte);
    if (bytes > LIMITE_CORPO_INTERNO_BYTES) {
      if (!excedeu) {
        excedeu = true;
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, motivo: "Corpo da requisição grande demais." }));
      }
      return;
    }
    corpo += parte;
  });
  req.on("end", () => {
    if (excedeu) return;
    let dados;
    try { dados = JSON.parse(corpo || "{}"); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, motivo: "JSON inválido." }));
      return;
    }
    void aoReceber(dados);
  });
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
      lerCorpoJsonInterno(req, res, async (dados) => {
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
      lerCorpoJsonInterno(req, res, async (dados) => {
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
      lerCorpoJsonInterno(req, res, async (dados) => {
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
    if (req.method === "POST" && req.url === "/interno/reaquecer") {
      lerCorpoJsonInterno(req, res, async (dados) => {
        try {
          const r = await reaquecerLead(dados.telefone);
          res.writeHead(r.ok ? 200 : 422, { "Content-Type": "application/json" });
          res.end(JSON.stringify(r));
        } catch (erro) {
          console.error("[REAQUECIDO] Erro:", erro.message);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, motivo: erro.message }));
        }
      });
      return;
    }

    if (req.method === "POST" && req.url === "/interno/resposta-do-doutor") {
      lerCorpoJsonInterno(req, res, async (dados) => {
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
const filaMensagens = criarFilaPorChave();
const entradasRecentes = new Map(); // telefone -> timestamps do último minuto
const avisosDeTaxa = new Map();

function permitirMensagemDoTelefone(telefone, agora = Date.now()) {
  const desde = agora - 60_000;
  const recentes = (entradasRecentes.get(telefone) || []).filter((t) => t >= desde);
  if (recentes.length >= LIMITE_MENSAGENS_POR_MINUTO) {
    entradasRecentes.set(telefone, recentes);
    return false;
  }
  recentes.push(agora);
  entradasRecentes.set(telefone, recentes);
  return true;
}

function deveAvisarLimiteDeTaxa(telefone, agora = Date.now()) {
  const ultimo = avisosDeTaxa.get(telefone) || 0;
  if (agora - ultimo < 60_000) return false;
  avisosDeTaxa.set(telefone, agora);
  return true;
}

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

function agendarProcessamento(jid, telefone, texto) {
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
    filaMensagens.enfileirar(telefone, async () => {
      // O socket que recebeu a mensagem pode ter caído durante os seis segundos de
      // debounce. Usa a conexão atual; sem conexão, processa mesmo assim e deixa a resposta
      // na caixa durável para a próxima abertura.
      const conexao = sockAtivo;
      if (conexao) await reenviarPendentesDoTelefone(conexao, telefone);
      if (textoCombinado.length > LIMITE_TEXTO_ENTRADA) {
        return processarFormatoNaoEntendido(conexao, buffer.jid, telefone, "texto_longo");
      }
      return processarMensagem(conexao, buffer.jid, telefone, textoCombinado);
    }).catch((erro) => {
      console.error("Erro ao processar mensagem:", erro);
    });
  }, DEBOUNCE_MS);
}

function sessaoPadrao(telefone) {
  return {
    telefone,
    historico: [],
    aguardandoHumano: false,
    aguardandoHumanoDesde: null,
    recadoDoDoutor: null,
    estadoAtendimento: EstadoAtendimento.reiniciarConversa(),
    triagemPendente: null,
    ultimoAgendamento: null,
  };
}

function normalizarSessao(telefone, existente) {
  const sessao = { ...sessaoPadrao(telefone), ...(existente || {}) };
  sessao.historico = Array.isArray(sessao.historico) ? sessao.historico : [];
  sessao.estadoAtendimento = EstadoAtendimento.normalizar(sessao.estadoAtendimento);
  return sessao;
}

function resumoDeAgendamento(agendamento) {
  if (!agendamento) return null;
  return {
    slotId: agendamento.slotId,
    crianca: agendamento.crianca,
    label: agendamento.diaLabel || agendamento.label,
    data: agendamento.data,
    horario: agendamento.horario,
    pago: !!agendamento.pago,
    estado: agendamento.estado,
  };
}

function agendamentoAtualReal(telefone, now = new Date()) {
  return Storage.proximaConsultaDoTelefone(telefone, now);
}

function sincronizarUltimoAgendamento(sessao, telefone, now = new Date()) {
  const atual = agendamentoAtualReal(telefone, now);
  sessao.ultimoAgendamento = resumoDeAgendamento(atual);
  const estado = EstadoAtendimento.normalizar(sessao.estadoAtendimento);
  if (atual && atual.pago) {
    sessao.estadoAtendimento = EstadoAtendimento.registrarPagamento(estado);
  } else if (atual && estado.etapa === EstadoAtendimento.ETAPAS.PAGO) {
    // O botão do painel pode ter sido desfeito desde a última mensagem. A agenda real é a
    // fonte de verdade; a sessão não pode continuar chamando de confirmada uma reserva.
    sessao.estadoAtendimento = EstadoAtendimento.registrarReserva(estado);
  } else if (!atual && [EstadoAtendimento.ETAPAS.PAGO,
    EstadoAtendimento.ETAPAS.AGUARDANDO_PAGAMENTO].includes(estado.etapa)) {
    sessao.estadoAtendimento = EstadoAtendimento.reiniciarConversa();
  }
  return atual;
}

function anexarRespostaFixaNoHistorico(telefone, texto, agora = new Date()) {
  const sessao = normalizarSessao(telefone, Storage.obterSessao(telefone));
  const historico = sessao.historico || [];
  const ultima = historico[historico.length - 1];
  if (!(ultima && ultima.role === "assistant" && ultima.content === texto)) {
    sessao.historico = [...historico, { role: "assistant", content: texto }].slice(-24);
  }
  sessao.ultimaAtividade = agora.toISOString();
  Storage.salvarSessao(telefone, sessao);
}

function registrarPagamentoNaSessao(telefone, agendamento) {
  const sessao = normalizarSessao(telefone, Storage.obterSessao(telefone));
  sessao.estadoAtendimento = EstadoAtendimento.registrarPagamento(sessao.estadoAtendimento);
  sessao.ultimoAgendamento = resumoDeAgendamento(agendamento || agendamentoAtualReal(telefone));
  Storage.salvarSessao(telefone, sessao);
}

function precoParticularInformado(texto) {
  const conteudo = String(texto || "");
  if (!/atendimento\s+(?:é\s+|eh\s+)?particular|consulta\s+(?:é\s+|eh\s+)?particular|particular[^\n]{0,100}R\$/i.test(conteudo)) return null;
  const valores = new Set();
  if (/R\$\s*550(?:[.,]00)?\b/i.test(conteudo)) valores.add(55000);
  if (/R\$\s*800(?:[.,]00)?\b/i.test(conteudo)) valores.add(80000);
  return valores.size === 1 ? [...valores][0] : null;
}

function combinarEfeitos(...efeitos) {
  const validos = efeitos.flat().filter(Boolean);
  if (validos.length === 0) return null;
  if (validos.length === 1) return validos[0];
  return { tipo: "multiplos", efeitos: validos };
}

function aplicarEfeitoAposEnvio(efeito) {
  if (!efeito || !efeito.tipo) return;
  if (efeito.tipo === "multiplos") {
    for (const item of efeito.efeitos || []) aplicarEfeitoAposEnvio(item);
  }
  else if (efeito.tipo === "registrar_preco") {
    const sessao = normalizarSessao(efeito.telefone, Storage.obterSessao(efeito.telefone));
    sessao.estadoAtendimento = EstadoAtendimento.registrarPreco(
      sessao.estadoAtendimento, efeito.valorCentavos, new Date());
    Storage.salvarSessao(efeito.telefone, sessao);
    Eventos.registrar("preco_informado", efeito.telefone, { valorCentavos: efeito.valorCentavos }, new Date());
  }
  else if (efeito.tipo === "marcar_guia") Storage.marcarGuiaAvisado(efeito.slotId);
  else if (efeito.tipo === "marcar_portal") Storage.marcarPortalAvisado(efeito.slotId);
  else if (efeito.tipo === "marcar_pagamento") Storage.marcarPagamentoAvisado(efeito.slotId);
  else if (efeito.tipo === "marcar_reaquecimento") {
    const sessao = normalizarSessao(efeito.telefone, Storage.obterSessao(efeito.telefone));
    if (!sessao.reaquecidoEm) sessao.reaquecidoEm = efeito.em || new Date().toISOString();
    Storage.salvarSessao(efeito.telefone, sessao);
  }
  else if (efeito.tipo === "marcar_lembrete") Storage.marcarLembreteEnviado(efeito.slotId, efeito.lembrete);
  else if (efeito.tipo === "marcar_apresentacao") {
    if (Storage.marcarApresentacao(efeito.telefone)) {
      console.log(`[APRESENTAÇÃO] ${efeito.telefone}: soube que a Carla é o atendimento automático`);
    }
  }
  else throw new Error(`Efeito desconhecido da caixa de saída: ${efeito.tipo}`);
}

const caixaDeSaida = criarCaixaDeSaida({
  storage: Storage,
  prepararMensagem: Previa.mensagemDeTexto,
  aplicarEfeito: aplicarEfeitoAposEnvio,
});

async function reenviarPendentesDoTelefone(sock, telefone) {
  return caixaDeSaida.reenviarDoTelefone(sock, telefone);
}

async function reenviarMensagensPendentes(sock) {
  const telefones = [...new Set(Storage.listarMensagensPendentes().map((m) => m.telefone))];
  const resultados = await Promise.allSettled(telefones.map((telefone) =>
    filaMensagens.enfileirar(telefone, () => reenviarPendentesDoTelefone(sock, telefone))
  ));
  const falhas = resultados.filter((r) => r.status === "rejected").length;
  if (falhas > 0) console.error(`[CAIXA DE SAÍDA] ${falhas} conversa(s) continuam pendentes de envio.`);
}

async function reconciliarPagamentosSemAviso() {
  const pendentes = Storage.lerAgendamentos().filter((a) =>
    a.estado === "pago" && a.pago && !a.pagamentoAvisadoEm
      && String(a.telefone || "").startsWith("+"));
  for (const agendamento of pendentes) {
    const resultado = await avisarPagamentoConfirmado(agendamento.slotId);
    if (!resultado.ok) {
      console.error(`[PAGAMENTO] Confirmação pendente de ${agendamento.slotId}: ${resultado.motivo}`);
    }
  }
}

async function enviarResposta(sock, jid, telefone, texto, semAtraso, {
  efeitoAposEnvio = null,
  chaveIdempotencia = null,
  registrarNoHistorico = false,
  registrarPreco = false,
  aposPersistir = null,
} = {}) {
  // Persiste ANTES do atraso de digitação e da rede. Se o processo cair em qualquer ponto,
  // a mensagem será reenviada na próxima conexão em vez de desaparecer.
  const valorCentavos = registrarPreco ? precoParticularInformado(texto) : null;
  const efeitos = combinarEfeitos(
    efeitoAposEnvio,
    valorCentavos ? { tipo: "registrar_preco", telefone, valorCentavos } : null,
  );
  const pendente = Storage.registrarMensagemPendente({
    telefone, jid, texto, efeitoAposEnvio: efeitos, chaveIdempotencia,
  });
  if (registrarNoHistorico) anexarRespostaFixaNoHistorico(telefone, texto);
  if (typeof aposPersistir === "function") await aposPersistir(pendente);
  // WhatsApp desconectado não desfaz uma decisão já tomada. A mensagem fica durável e a
  // connection.update a entrega assim que uma nova sessão abrir.
  if (!sock) return { ok: true, pendente: true, id: pendente.id };
  if (!semAtraso) {
    await sock.presenceSubscribe(jid).catch(() => {});
    await sock.sendPresenceUpdate("composing", jid).catch(() => {});
    await new Promise((r) => setTimeout(r, ATRASO_RESPOSTA_MS));
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});
  }
  try {
    await caixaDeSaida.tentarEnviar(sock, pendente);
    return { ok: true, enviada: true, id: pendente.id };
  } catch (erro) {
    // tentarEnviar já registrou a falha. Não converte a queda da rede em perda do efeito:
    // quem chamou pode seguir, porque o reenvio automático tem tudo de que precisa.
    return { ok: true, pendente: true, id: pendente.id, motivo: erro.message };
  }
}

// Áudio (mensagem de voz ou arquivo de áudio) — a Carla ainda não consegue ouvir, então só
// pede, de forma fixa e educada, pra mandar por escrito. Sempre determinístico, nunca passa
// pela IA. Respeita silêncio manual e atendimento humano em andamento, igual mensagem de texto.
const PEDIDO_MANDAR_POR_ESCRITO = "Oi 😊 Por aqui eu ainda não consigo ouvir áudio. Poderia me mandar por escrito, por favor? Assim consigo te ajudar certinho.";
const PEDIDO_DESCREVER_MIDIA = "Oi 😊 Recebi a mídia, mas preciso que você me diga por escrito o que quer que eu observe ou resolva. Assim consigo te ajudar certinho.";
const PEDIDO_REENVIAR_FORMATO = "Oi 😊 Recebi sua mensagem, mas ela veio num formato que eu ainda não consigo ler. Pode me mandar em texto, por favor?";
const PEDIDO_DIVIDIR_TEXTO = "Oi 😊 Essa mensagem ficou grande demais para eu analisar com segurança. Pode dividir em duas ou três mensagens menores, por favor?";
const AVISO_MUITAS_MENSAGENS = "Recebi suas mensagens 😊 Vou processar o que já chegou. Aguarde um instante antes de mandar mais, por favor.";

async function processarAudioRecebido(sock, jid, telefone) {
  if (Storage.contatoSilenciado(telefone)) return;
  const sessao = Storage.obterSessao(telefone);
  if (sessao && sessao.aguardandoHumano) return;
  await enviarResposta(sock, jid, telefone, PEDIDO_MANDAR_POR_ESCRITO, false, {
    registrarNoHistorico: true,
  });
}

async function processarFormatoNaoEntendido(sock, jid, telefone, tipo = "desconhecido") {
  if (Storage.contatoSilenciado(telefone)) return;
  const sessao = Storage.obterSessao(telefone);
  if (sessao && sessao.aguardandoHumano) return;
  const texto = tipo === "midia"
    ? PEDIDO_DESCREVER_MIDIA
    : tipo === "texto_longo"
      ? PEDIDO_DIVIDIR_TEXTO
      : tipo === "taxa"
        ? AVISO_MUITAS_MENSAGENS
        : PEDIDO_REENVIAR_FORMATO;
  await enviarResposta(sock, jid, telefone, texto, true, {
    chaveIdempotencia: tipo === "taxa"
      ? `limite-taxa:${telefone}:${Math.floor(Date.now() / 60_000)}`
      : null,
    registrarNoHistorico: true,
  });
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
    await enviarResposta(sock, jid, telefoneDrBruno, texto, true);
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
    await enviarResposta(sock, jid, telefoneDrBruno, linhas.join("\n"), true);
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
    await enviarResposta(sock, jid, telefoneDrBruno, linhas.join("\n"), true);
  } catch (erro) {
    console.error("[NOTIFICAÇÃO] Erro ao chamar o Dr. Bruno:", erro.message);
  }
}

function intervaloDoSlot(slot) {
  const [ano, mes, dia] = String(slot.date || slot.data || "").split("-").map(Number);
  const [hora, minuto] = String(slot.time || slot.horario || "").split(":").map(Number);
  const inicio = new Date(ano, mes - 1, dia, hora, minuto);
  const duracao = (global.CARLA_CONFIG && global.CARLA_CONFIG.duracaoConsultaMin) || 60;
  return { inicio, fim: new Date(inicio.getTime() + duracao * 60_000) };
}

async function enfileirarIntegracoesDaReserva(acao, telefone) {
  // slot.id identifica a vaga da grade; slotId identifica ESTA reserva. Depois que um
  // horário vencido é reaberto, só o segundo continua sendo único e seguro para retries.
  const slotId = acao?.slotId || acao?.agendamento?.slotId || acao?.slot?.id;
  const agendamento = slotId ? Storage.acharAgendamentoPorSlot(slotId) : null;
  if (!agendamento) {
    console.error(`[EFEITOS] Reserva sem agendamento local correspondente: ${slotId || "sem slot"}.`);
    return null;
  }
  const { inicio, fim } = intervaloDoSlot(agendamento);

  const criacaoSpi = await integracoes.caixa.obter(`spi:marcar:${agendamento.slotId}`);
  if (!agendamento.appAgendamentoId && !criacaoSpi) {
    await integracoes.agendarCriacaoSpi({
      slotId: agendamento.slotId,
      dados: {
        pacienteNome: agendamento.crianca,
        responsavelNome: agendamento.responsavel,
        telefone: agendamento.telefone || telefone,
        dataNascimento: agendamento.criancaDataNascimento || null,
        email: agendamento.responsavelEmail || null,
        inicio,
        fim,
        observacoes: "Agendado pela Carla (WhatsApp)",
      },
    });
  }

  // Compatibilidade durante a transição: uma reserva antiga pode já ter sido criada no
  // Google pelo caminho legado. Nesse caso não cria uma segunda; reservas novas chegam sem
  // ID e usam sempre o ID determinístico da caixa durável.
  const criacaoGoogle = await integracoes.caixa.obter(`google:criar:${agendamento.slotId}`);
  if (!agendamento.googleEventId && !criacaoGoogle) {
    await integracoes.agendarCriacaoGoogle({
      slotId: agendamento.slotId,
      inicio,
      fim,
      titulo: `Consulta - ${agendamento.crianca}`,
      descricao: `Responsável: ${agendamento.responsavel}\nTelefone: ${agendamento.telefone || telefone}\nAgendado pela Carla (WhatsApp)`,
    });
  }

  if (agendamento.responsavelEmail || agendamento.criancaDataNascimento) {
    await integracoes.registrarDadosPaciente({
      slotId: agendamento.slotId,
      appAgendamentoId: agendamento.appAgendamentoId || undefined,
      email: agendamento.responsavelEmail || undefined,
      dataNascimento: agendamento.criancaDataNascimento || undefined,
    });
  }
  return agendamento;
}

async function enfileirarDadosDoPaciente(dados, telefone) {
  if (!dados || (!dados.email && !dados.dataNascimento)) return null;
  const slotId = dados.slotId || agendamentoAtualReal(telefone)?.slotId;
  if (!slotId) {
    console.error("[EFEITOS] Dados do paciente sem slotId; ficaram guardados localmente, mas não foram enviados ao SPI.");
    return null;
  }
  const agendamento = Storage.acharAgendamentoPorSlot(slotId);
  return integracoes.registrarDadosPaciente({
    slotId,
    appAgendamentoId: agendamento?.appAgendamentoId || undefined,
    email: dados.email || undefined,
    dataNascimento: dados.dataNascimento || undefined,
  });
}

async function enfileirarCancelamentoExterno(cancelado) {
  if (!cancelado?.slotId) return null;
  const criacaoSpi = await integracoes.caixa.obter(`spi:marcar:${cancelado.slotId}`);
  const criacaoGoogle = await integracoes.caixa.obter(`google:criar:${cancelado.slotId}`);
  const agendouSpi = !!cancelado.appAgendamentoId || !!criacaoSpi;
  const agendouGoogle = !!cancelado.googleEventId || !!criacaoGoogle;
  if (agendouSpi) {
    await integracoes.agendarCancelamentoSpi({
      slotId: cancelado.slotId,
      appAgendamentoId: cancelado.appAgendamentoId || undefined,
    });
  }
  if (agendouGoogle) {
    await integracoes.agendarCancelamentoGoogle({
      slotId: cancelado.slotId,
      eventId: cancelado.googleEventId || undefined,
    });
  }
  return { agendouSpi, agendouGoogle };
}

// Fecha a janela de queda entre a reserva SQLite e a gravação dos efeitos externos. Só
// reservas criadas já sob este contrato entram aqui; registros legados podem existir no
// Google/SPI sem IDs locais e não são recriados no escuro.
async function reconciliarReservasAtivasSemEfeito() {
  let recuperadas = 0;
  for (const agendamento of Storage.lerAgendamentos().filter((a) => a.integracoesDuraveis)) {
    try {
      const spi = await integracoes.caixa.obter(`spi:marcar:${agendamento.slotId}`);
      const google = await integracoes.caixa.obter(`google:criar:${agendamento.slotId}`);
      const faltava = (!agendamento.appAgendamentoId && !spi)
        || (!agendamento.googleEventId && !google);
      if (faltava) {
        await enfileirarIntegracoesDaReserva({ slotId: agendamento.slotId }, agendamento.telefone);
        recuperadas++;
      }
    } catch (erro) {
      console.error(`[EFEITOS] Não consegui reconciliar a reserva ${agendamento.slotId}:`, erro.message);
    }
  }
  if (recuperadas) console.log(`[EFEITOS] ${recuperadas} reserva(s) recuperada(s) após falha intermediária.`);
  return recuperadas;
}

let limpandoReservasVencidas = false;
async function limparReservasVencidas() {
  if (limpandoReservasVencidas) return;
  limpandoReservasVencidas = true;
  try {
    await reconciliarReservasAtivasSemEfeito();
    const vencidas = Storage.listarVencimentosPendentesDeLimpeza(new Date());
    for (const reserva of vencidas) await enfileirarCancelamentoExterno(reserva);
    if (vencidas.length) await integracoes.reconciliar({ limite: 50 });

    for (const reserva of vencidas) {
      const criacaoSpi = await integracoes.caixa.obter(`spi:marcar:${reserva.slotId}`);
      const cancelamentoSpi = await integracoes.caixa.obter(`spi:cancelar:${reserva.slotId}`);
      const eventId = reserva.googleEventId || integracoes.eventIdGoogleDoSlot(reserva.slotId);
      const criacaoGoogle = await integracoes.caixa.obter(`google:criar:${reserva.slotId}`);
      const cancelamentoGoogle = await integracoes.caixa.obter(`google:cancelar:${eventId}`);
      const spiConcluido = (!reserva.appAgendamentoId && !criacaoSpi)
        || cancelamentoSpi?.estado === "concluido";
      const googleConcluido = (!reserva.googleEventId && !criacaoGoogle)
        || cancelamentoGoogle?.estado === "concluido";
      if (spiConcluido && googleConcluido) {
        Storage.marcarVencimentoSincronizado(reserva.slotId, {
          spi: agendamentoEstado(cancelamentoSpi),
          google: agendamentoEstado(cancelamentoGoogle),
        });
      }
    }
  } catch (erro) {
    console.error("[VENCIMENTOS] Falha ao reconciliar reservas vencidas:", erro.message);
  } finally {
    limpandoReservasVencidas = false;
  }
}

function agendamentoEstado(efeito) {
  return efeito ? efeito.estado : "não necessário";
}

const timerReservasVencidas = setInterval(() => { void limparReservasVencidas(); }, 60_000);
if (typeof timerReservasVencidas.unref === "function") timerReservasVencidas.unref();
void limparReservasVencidas();

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
  return filaMensagens.enfileirar(alerta.telefone, () =>
    responderEscaladaNaFila(alertaId, resposta)
  );
}

async function responderEscaladaNaFila(alertaId, resposta) {
  const alerta = Storage.acharAlerta(alertaId);
  if (!alerta) return { ok: false, motivo: "Não achei esse alerta." };
  if (alerta.respondidoEm) return { ok: true, jaRespondido: true };
  if (!alerta.pergunta) return { ok: false, motivo: "Esse alerta não tem pergunta pra responder." };

  const telefone = alerta.telefone;
  const jid = telefone.replace("+", "") + "@s.whatsapp.net";
  const respostaNormalizada = String(resposta == null ? "" : resposta).trim().slice(0, 300);
  if (!respostaNormalizada) return { ok: false, motivo: "Resposta vazia." };

  const sessao = normalizarSessao(telefone, Storage.obterSessao(telefone));
  // Tira do silêncio: foi a escalada que parou a conversa, e ela acabou de ser resolvida.
  sessao.aguardandoHumano = false;
  sessao.aguardandoHumanoDesde = null;
  sessao.recadoDoDoutor = { pergunta: alerta.pergunta, resposta: respostaNormalizada };

  // A API precisa de um turno da família pra responder. Este texto é só o gatilho; o que vale
  // está no contexto, e o prompt manda ignorar qualquer "recado" que venha pela conversa.
  const gatilho = "(o Dr. Bruno respondeu o que você perguntou a ele)";
  try {
    const consultaReal = agendamentoAtualReal(telefone);
    sincronizarUltimoAgendamento(sessao, telefone);
    const resultado = await CerebroIA.responder({
      telefone, texto: gatilho, historico: sessao.historico || [], now: new Date(),
      idsOcupados: Storage.idsOcupados(),
      agendamentoAtual: resumoDeAgendamento(consultaReal),
      pacienteConhecido: Storage.ehPacienteConhecido(telefone),
      portalJaLiberado: Storage.lerAgendamentos().some((a) => a.telefone === telefone && a.portalAvisadoEm),
      guiaJaLiberado: Storage.lerAgendamentos().some((a) => a.telefone === telefone && a.guiaAvisadoEm),
      horariosOferecidos: sessao.horariosOferecidos || [],
      consultaProxima: consultaReal ? {
        crianca: consultaReal.crianca,
        diaLabel: consultaReal.diaLabel,
        ehHoje: consultaReal.data === Agenda.toDateStr(new Date()),
      } : null,
      recadoDoDoutor: sessao.recadoDoDoutor,
      estadoAtendimento: sessao.estadoAtendimento,
      triagemPendente: sessao.triagemPendente,
    });
    sessao.historico = resultado.historico;
    sessao.horariosOferecidos = resultado.horariosOferecidos;
    sessao.estadoAtendimento = EstadoAtendimento.normalizar(
      resultado.estadoAtendimento || sessao.estadoAtendimento);
    sessao.triagemPendente = resultado.triagemPendente ?? sessao.triagemPendente;
    sessao.ultimaAtividade = new Date().toISOString();

    for (const acao of resultado.acoes || []) {
      console.log(`[AGENDADO] ${acao.responsavel} / ${acao.crianca} em ${acao.slot.label}`);
      await enfileirarIntegracoesDaReserva(acao, telefone);
      notificarNovoAgendamento(sockAtivo, acao, telefone);
    }
    for (const cancelado of resultado.cancelamentos || []) {
      await enfileirarCancelamentoExterno(cancelado);
    }
    if (resultado.dadosDoPaciente) {
      await enfileirarDadosDoPaciente(resultado.dadosDoPaciente, telefone);
    }
    sincronizarUltimoAgendamento(sessao, telefone);
    Storage.salvarSessao(telefone, sessao);

    if (!resultado.resposta) return { ok: false, motivo: "A Carla não produziu a resposta da família." };
    await enviarResposta(sockAtivo, jid, telefone, resultado.resposta, true, { registrarPreco: true });
    // Só agora o alerta vira respondido: antes disso a resposta ainda não estava sequer na
    // caixa de saída, e uma queda criava um alerta fechado sem mensagem para a família.
    const gravado = Storage.responderAlerta(alertaId, respostaNormalizada);
    if (!gravado) return { ok: false, motivo: "Não consegui concluir o alerta." };
    console.log(`[RESPOSTA DO DOUTOR] ${telefone}: "${respostaNormalizada}" para "${alerta.pergunta}"`);
    return { ok: true };
  } catch (erro) {
    console.error("[RESPOSTA DO DOUTOR] Erro ao retomar a conversa:", erro.message);
    return { ok: false, motivo: erro.message };
  }
}

// REAQUECER UM LEAD. O Dr. Bruno aperta o botão no painel e a Carla manda UMA mensagem pra
// uma família que sumiu sem fechar. Se ela responder, a conversa segue normal, sozinha.
//
// Mesmo desenho do responderEscalada: o painel não tem a conexão do WhatsApp, então ele
// encaminha pra cá; o contexto entra pelo PROMPT DO SISTEMA, nunca como turno da conversa
// (turno seria a Carla achando que a família disse aquilo); e o gatilho é um texto neutro
// só pra a API ter um turno de usuário.
//
// O contexto é convertido em FATOS antes de sair daqui. Os turnos antigos não vão junto de
// propósito: a limpeza das 4h existe pra impedir a Carla de retomar assunto velho do meio,
// e ressuscitar a conversa traria esse defeito de volta junto com a memória.
async function reaquecerLead(telefone) {
  if (!telefone) return { ok: false, motivo: "Sem telefone." };
  return filaMensagens.enfileirar(telefone, () => reaquecerLeadNaFila(telefone));
}

async function reaquecerLeadNaFila(telefone) {
  if (!telefone) return { ok: false, motivo: "Sem telefone." };
  const jid = telefone.replace("+", "") + "@s.whatsapp.net";
  const sessaoExistente = Storage.obterSessao(telefone);
  if (!sessaoExistente) return { ok: false, motivo: "Esse número nunca falou com a Carla." };
  const sessao = normalizarSessao(telefone, sessaoExistente);
  const ancoraReaquecimento = sessao.ultimaAtividade || "sem-atividade";

  const agora = new Date();
  const doFunil = Eventos.funil().contatos.find((c) => c.telefone === telefone) || {};

  // "Respondeu alguma vez" é o histórico ter turno da família. Quem só recebeu e nunca
  // escreveu de volta não é lead esfriado, e é ali que mora o bloqueio de número.
  const respondeuAlgumaVez = (sessao.historico || []).some((m) => m && m.role === "user");

  const veredito = Reaquecimento.podeReaquecer({
    silenciado: Storage.contatoSilenciado(telefone),
    aguardandoHumano: !!sessao.aguardandoHumano,
    temConsultaFutura: !!Storage.proximaConsultaDoTelefone(telefone, agora),
    jaReaquecidoEm: sessao.reaquecidoEm || null,
    ultimaAtividade: sessao.ultimaAtividade || null,
    respondeuAlgumaVez,
  }, agora);
  if (!veredito.pode) return { ok: false, motivo: veredito.motivo };
  sincronizarUltimoAgendamento(sessao, telefone, agora);

  const reaquecimento = {
    fatos: Reaquecimento.montarContexto({
      ultimaAtividade: sessao.ultimaAtividade,
      primeiraPergunta: doFunil.primeiraPergunta || null,
      recebeuPreco: !!doFunil.recebeuPreco,
      recebeuHorario: !!doFunil.recebeuHorario,
      crianca: (sessao.ultimoAgendamento && sessao.ultimoAgendamento.crianca) || null,
    }, agora),
    instrucao: Reaquecimento.montarInstrucao(),
  };

  // A conversa recomeça do zero de propósito: o que ela precisa saber está nos fatos.
  const gatilho = "(o consultório está retomando o contato com esta família)";
  try {
    const resultado = await CerebroIA.responder({
      telefone, texto: gatilho, historico: [], now: agora,
      idsOcupados: Storage.idsOcupados(),
      agendamentoAtual: null,
      pacienteConhecido: Storage.ehPacienteConhecido(telefone),
      portalJaLiberado: false,
      guiaJaLiberado: false,
      horariosOferecidos: [],
      consultaProxima: null,
      recadoDoDoutor: null,
      reaquecimento,
      estadoAtendimento: sessao.estadoAtendimento,
      triagemPendente: sessao.triagemPendente,
    });
    if (!resultado.resposta) return { ok: false, motivo: "A Carla não produziu mensagem." };

    // A fila por telefone impede dois cliques simultâneos neste processo. A marca abaixo só
    // é gravada depois que a mensagem já existe na caixa durável; assim uma queda nunca
    // deixa "reaquecido" sem haver mensagem para entregar.
    sessao.reaquecidoEm = agora.toISOString();
    sessao.historico = resultado.historico;
    sessao.horariosOferecidos = resultado.horariosOferecidos || [];
    sessao.estadoAtendimento = EstadoAtendimento.normalizar(
      resultado.estadoAtendimento || sessao.estadoAtendimento);
    sessao.triagemPendente = resultado.triagemPendente ?? sessao.triagemPendente;
    sessao.ultimaAtividade = agora.toISOString();

    for (const acao of resultado.acoes || []) {
      await enfileirarIntegracoesDaReserva(acao, telefone);
      notificarNovoAgendamento(sockAtivo, acao, telefone);
    }
    for (const cancelado of resultado.cancelamentos || []) {
      await enfileirarCancelamentoExterno(cancelado);
    }
    if (resultado.dadosDoPaciente) {
      await enfileirarDadosDoPaciente(resultado.dadosDoPaciente, telefone);
    }
    sincronizarUltimoAgendamento(sessao, telefone, agora);

    await enviarResposta(sockAtivo, jid, telefone, resultado.resposta, true, {
      registrarPreco: true,
      chaveIdempotencia: `reaquecimento:${telefone}:${ancoraReaquecimento}`,
      efeitoAposEnvio: { tipo: "marcar_reaquecimento", telefone, em: agora.toISOString() },
      aposPersistir: () => {
        Storage.salvarSessao(telefone, sessao);
        Eventos.registrar("reaquecido", telefone, {}, agora);
      },
    });
    console.log(`[REAQUECIDO] ${telefone}: "${resultado.resposta.slice(0, 80)}"`);
    return { ok: true, mensagem: resultado.resposta };
  } catch (erro) {
    console.error("[REAQUECIDO] Erro:", erro.message);
    return { ok: false, motivo: erro.message };
  }
}

async function processarMensagem(sock, jid, telefone, texto, { semAtraso = false } = {}) {
  // Lido ANTES de qualquer coisa criar sessão: é o que diz se este número já falou com a
  // Carla alguma vez. Vira o topo do funil, e só pode ser contado uma vez por número.
  const jaTeveSessao = !!Storage.obterSessao(telefone);
  const sessao = normalizarSessao(telefone, Storage.obterSessao(telefone));
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
    sessao.estadoAtendimento = EstadoAtendimento.reiniciarConversa();
    sessao.triagemPendente = null;
  }

  // 1) Triagem sempre primeiro, sempre determinística — nunca passa pela IA. Sinais
  // objetivos orientam emergência já; frases ambíguas fazem UMA pergunta de confirmação e
  // essa pendência fica na sessão, em vez de o modelo precisar adivinhar o que perguntou.
  const avaliacaoEmergencia = CerebroIA.avaliarEmergencia(texto);
  const confirmouPerigoPendente = !!sessao.triagemPendente
    && TriagemEmergencia.respostaConfirmaPerigo(texto);
  const negouPerigoPendente = !!sessao.triagemPendente
    && /\b(?:não|nao|negativo|nenhum|normal|melhorou|passou)\b/i.test(texto);

  if (avaliacaoEmergencia.nivel === "emergencia" || confirmouPerigoPendente) {
    Storage.registrarAlertaUrgencia({ telefone, mensagem: texto, tipo: "emergencia" });
    console.log(`[ALERTA: URGÊNCIA] ${telefone}: "${texto}"`);
    // Antes de responder a família, pra já estar a caminho. Não é aguardada.
    notificarAtencao(sock, { tipo: "emergencia", telefoneFamilia: telefone, texto });
    const respostaEmergencia = TriagemEmergencia.respostaDeEmergencia();
    sessao.historico = [...(sessao.historico || []), { role: "user", content: texto }].slice(-24);
    sessao.triagemPendente = null;
    sessao.aguardandoHumano = false;
    sessao.aguardandoHumanoDesde = null;
    sessao.ultimaAtividade = now.toISOString();
    sessao.ultimaMensagem = texto.slice(0, 140);
    Storage.salvarSessao(telefone, sessao);
    await enviarResposta(sock, jid, telefone, respostaEmergencia, semAtraso, {
      registrarNoHistorico: true,
    });
    return;
  }

  if (sessao.triagemPendente && !negouPerigoPendente) {
    const pergunta = TriagemEmergencia.respostaDeConfirmacao();
    sessao.historico = [...(sessao.historico || []), { role: "user", content: texto }].slice(-24);
    sessao.ultimaAtividade = now.toISOString();
    sessao.ultimaMensagem = texto.slice(0, 140);
    Storage.salvarSessao(telefone, sessao);
    await enviarResposta(sock, jid, telefone, pergunta, semAtraso, { registrarNoHistorico: true });
    return;
  }
  if (negouPerigoPendente) sessao.triagemPendente = null;

  if (avaliacaoEmergencia.nivel === "confirmar") {
    const pergunta = TriagemEmergencia.respostaDeConfirmacao();
    sessao.triagemPendente = {
      termo: avaliacaoEmergencia.termo,
      criadaEm: now.toISOString(),
    };
    sessao.historico = [...(sessao.historico || []), { role: "user", content: texto }].slice(-24);
    sessao.ultimaAtividade = now.toISOString();
    sessao.ultimaMensagem = texto.slice(0, 140);
    Storage.salvarSessao(telefone, sessao);
    await enviarResposta(sock, jid, telefone, pergunta, semAtraso, { registrarNoHistorico: true });
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

  // FUNIL. Registra o que chegou e como isso se classifica. Fica DEPOIS da emergência, do
  // silêncio manual e do comprovante de propósito: aquelas mensagens não são etapa de funil
  // comercial, e contá-las inflaria o topo com quem já é paciente.
  //
  // "contato" só sai uma vez por número, na vida. É o topo do funil, e o teste de "nunca
  // falou com a gente" é a sessão não existir ainda, o mesmo sinal que a apresentação usa.
  if (!jaTeveSessao) Eventos.registrar("contato", telefone, {}, now);
  Eventos.registrar("mensagem", telefone, {
    classe: Eventos.classificar(texto),
    trecho: Eventos.trecho(texto),
    primeiraDaConversa: ehPrimeiraMensagemDaConversa,
  }, now);

  const idsOcupados = Storage.idsOcupados();
  const consultaReal = agendamentoAtualReal(telefone, now);
  sincronizarUltimoAgendamento(sessao, telefone, now);
  const resultado = await CerebroIA.responder({
    telefone, texto, historico: sessao.historico || [], now, idsOcupados,
    // Nunca confia no cache da conversa para afirmar que uma consulta existe: cancelamento,
    // vencimento ou pagamento podem ter acontecido no painel desde a última mensagem.
    agendamentoAtual: resumoDeAgendamento(consultaReal),
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
      const c = consultaReal;
      return c ? { crianca: c.crianca, diaLabel: c.diaLabel, ehHoje: c.data === Agenda.toDateStr(now) } : null;
    })(),
    estadoAtendimento: sessao.estadoAtendimento,
    triagemPendente: sessao.triagemPendente,
  });

  sessao.historico = resultado.historico;
  sessao.estadoAtendimento = EstadoAtendimento.normalizar(
    resultado.estadoAtendimento || sessao.estadoAtendimento);
  sessao.triagemPendente = resultado.triagemPendente ?? sessao.triagemPendente;
  const horariosAntes = (sessao.horariosOferecidos || []).length;
  sessao.horariosOferecidos = resultado.horariosOferecidos || [];

  // Etapa do horário: a lista de ofertas cresceu nesta rodada, ou seja, a ferramenta
  // devolveu horário e ele foi parar na mensagem.
  if ((resultado.horariosOferecidos || []).length > horariosAntes) {
    Eventos.registrar("horarios_oferecidos", telefone, {
      quantidade: (resultado.horariosOferecidos || []).length - horariosAntes,
    }, now);
  }

  for (const acao of resultado.acoes || []) {
    console.log(`[AGENDADO] ${acao.responsavel} / ${acao.crianca} em ${acao.slot.label}`);
    await enfileirarIntegracoesDaReserva(acao, telefone);
    const reservado = Storage.acharAgendamentoPorSlot(
      acao.slotId || acao.agendamento?.slotId || acao.slot.id);
    sessao.ultimoAgendamento = resumoDeAgendamento(reservado);
    Eventos.registrar("agendou", telefone, { crianca: acao.crianca, quando: acao.slot.label }, now);
    notificarNovoAgendamento(sock, acao, telefone);
  }

  for (const cancelado of resultado.cancelamentos || []) {
    await enfileirarCancelamentoExterno(cancelado);
    console.log(`[CANCELADO PELA IA] ${telefone} — ${cancelado.crianca} em ${cancelado.label}`);
    Eventos.registrar("cancelou", telefone, { crianca: cancelado.crianca }, now);
  }

  // Recalcula inclusive depois de um cancelamento. Assim uma consulta apagada ou vencida
  // nunca continua parecendo ativa só porque estava guardada na sessão.
  sincronizarUltimoAgendamento(sessao, telefone, now);

  if (resultado.dadosDoPaciente) {
    await enfileirarDadosDoPaciente(resultado.dadosDoPaciente, telefone);
    console.log(`[DADOS DO PORTAL] ${telefone}: ${JSON.stringify(resultado.dadosDoPaciente)}`);
    notificarDadosDoPaciente(sock, resultado.dadosDoPaciente, sessao.ultimoAgendamento, telefone);
  }

  if (resultado.escalar) {
    sessao.aguardandoHumano = true;
    sessao.aguardandoHumanoDesde = now.toISOString();
    Eventos.registrar("escalou", telefone, { motivo: Eventos.trecho(resultado.escalar) }, now);
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

  const precisaMarcarApresentacao = ehPrimeiraMensagemDaConversa
    && !Storage.ehPacienteNoPainel(telefone)
    && !Storage.jaSeApresentou(telefone);
  await enviarResposta(sock, jid, telefone, resultado.resposta, semAtraso,
    {
      ...(precisaMarcarApresentacao ? {
        chaveIdempotencia: `apresentacao:${telefone}`,
        efeitoAposEnvio: { tipo: "marcar_apresentacao", telefone },
      } : {}),
      // O estado e o funil só avançam quando a mensagem efetivamente deixa a caixa. Se o
      // WhatsApp cair, o efeito acompanha a mensagem e roda no reenvio — nunca antes.
      registrarPreco: true,
    });
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
      await filaMensagens.enfileirar(a.telefone, () =>
        enviarResposta(sock, jid, a.telefone, texto, true, {
          chaveIdempotencia: `lembrete:semanaAntes:${a.slotId}`,
          efeitoAposEnvio: { tipo: "marcar_lembrete", slotId: a.slotId, lembrete: "semanaAntes" },
          registrarNoHistorico: true,
        }));
      console.log(`[LEMBRETE 1 semana antes] ${a.telefone} — ${a.crianca} em ${a.diaLabel}`);
    } catch (erro) {
      console.error(`[LEMBRETE] Falhou ao avisar ${a.telefone}:`, erro.message);
    }
  }

  for (const a of Storage.agendamentosProntosParaLembrete(hojeStr, "diaDaConsulta")) {
    const jid = a.telefone.replace("+", "") + "@s.whatsapp.net";
    const texto = `Bom dia! Só confirmando: hoje é o dia da consulta de ${a.crianca} com o Dr. Bruno, às ${Agenda.formatHora(a.horario)}.\n\nEndereço: ${CARLA_CONFIG.endereco}\n\nAté já! 😊`;
    try {
      await filaMensagens.enfileirar(a.telefone, () =>
        enviarResposta(sock, jid, a.telefone, texto, true, {
          chaveIdempotencia: `lembrete:diaDaConsulta:${a.slotId}`,
          efeitoAposEnvio: { tipo: "marcar_lembrete", slotId: a.slotId, lembrete: "diaDaConsulta" },
          registrarNoHistorico: true,
        }));
      console.log(`[LEMBRETE dia da consulta] ${a.telefone} — ${a.crianca} às ${a.horario}`);
    } catch (erro) {
      console.error(`[LEMBRETE] Falhou ao avisar ${a.telefone}:`, erro.message);
    }
  }
}

let sockAtivo = null;
let ultimoDiaLembretesEnviados = null;
let geracaoConexao = 0;
let tentativaReconexao = 0;
let timerReconexao = null;

function checarLembretes() {
  if (!sockAtivo) return;
  const agora = new Date();
  if (agora.getHours() < HORA_LEMBRETES) return;
  const hojeStr = Agenda.toDateStr(agora);
  if (ultimoDiaLembretesEnviados === hojeStr) return;
  ultimoDiaLembretesEnviados = hojeStr;
  enviarLembretes(sockAtivo).catch((erro) => console.error("[LEMBRETE] Erro geral:", erro.message));
}

const timerLembretes = setInterval(checarLembretes, 15 * 60 * 1000);
// O painel distingue "processo vivo" de "WhatsApp realmente conectado". Um pulso curto
// também denuncia processo travado: se esta gravação parar por três minutos, a tela avisa.
const timerStatusWhatsapp = setInterval(() => {
  if (sockAtivo) StatusWhatsapp.registrar("conectado");
}, 60_000);
if (typeof timerStatusWhatsapp.unref === "function") timerStatusWhatsapp.unref();

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
    return filaMensagens.enfileirar(telefone, async () => {
      await reenviarPendentesDoTelefone(sockAtivo, telefone);
      return processarMensagem(sockAtivo, buffer.jid, telefone, textoCombinado, { semAtraso: true });
    })
      .catch((erro) => console.error("[ENCERRANDO] Erro ao esvaziar mensagem pendente:", erro.message));
  }));
}

let encerrando = false;
async function encerrarComCalma(sinal) {
  if (encerrando) return;
  encerrando = true;
  clearInterval(timerReservasVencidas);
  clearInterval(timerLembretes);
  clearInterval(timerStatusWhatsapp);
  if (timerReconexao) clearTimeout(timerReconexao);
  pararReconciliadorIntegracoes();
  StatusWhatsapp.registrar("parando");
  if (buffers.size > 0) {
    console.log(`[${sinal}] Encerrando — respondendo ${buffers.size} mensagem(ns) pendente(s) antes de sair...`);
    await flushBuffersPendentes();
  }
  // Também espera mensagens que já saíram do debounce e estão no meio da IA/ferramentas.
  // Antes, o handler chamava process.exit mesmo com uma conversa ainda sendo processada.
  await filaMensagens.aguardarVazio();
  process.exit(0);
}

process.on("SIGINT", () => encerrarComCalma("SIGINT"));
process.on("SIGTERM", () => encerrarComCalma("SIGTERM"));

// O monitor registra e deixa o comportamento padrão do Node encerrar o processo. O PM2
// então reinicia, sem transformar uma exceção fatal em um processo aparentemente vivo.
process.on("uncaughtExceptionMonitor", (erro, origem) => {
  console.error(`[FATAL] Exceção não capturada (${origem}):`, erro);
});
process.on("unhandledRejection", (motivo) => {
  console.error("[FATAL] Promise rejeitada sem tratamento:", motivo);
  throw motivo instanceof Error ? motivo : new Error(String(motivo));
});

function agendarReconexao(motivo = "conexão encerrada") {
  if (encerrando || timerReconexao) return;
  StatusWhatsapp.registrar("reconectando");
  const base = Math.min(60000, 2000 * (2 ** Math.min(tentativaReconexao, 5)));
  const atraso = base + Math.floor(Math.random() * 1000);
  tentativaReconexao++;
  console.log(`[WHATSAPP] Nova tentativa em ${Math.ceil(atraso / 1000)}s (${motivo}).`);
  timerReconexao = setTimeout(() => {
    timerReconexao = null;
    iniciar().catch((erro) => {
      console.error("[WHATSAPP] Falha ao iniciar conexão:", erro.message);
      agendarReconexao("falha ao iniciar");
    });
  }, atraso);
}

async function iniciar() {
  if (encerrando) return;
  StatusWhatsapp.registrar("conectando");
  const geracao = ++geracaoConexao;
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
      if (geracao !== geracaoConexao) return;
      if (sockAtivo === sock) sockAtivo = null;
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const deveReconectar = codigo !== DisconnectReason.loggedOut;
      StatusWhatsapp.registrar(deveReconectar ? "reconectando" : "sessao_desconectada");
      console.log("Conexão encerrada.", deveReconectar ? "A reconexão automática foi agendada." : "Sessão desconectada — apague a pasta data/auth e rode de novo pra gerar um novo QR code.");
      if (deveReconectar) agendarReconexao(`código ${codigo || "desconhecido"}`);
    } else if (connection === "open") {
      if (geracao !== geracaoConexao) return;
      console.log("Carla está conectada e respondendo no WhatsApp!");
      sockAtivo = sock;
      StatusWhatsapp.registrar("conectado");
      tentativaReconexao = 0;
      if (timerReconexao) {
        clearTimeout(timerReconexao);
        timerReconexao = null;
      }
      (async () => {
        await reenviarMensagensPendentes(sock);
        await reconciliarPagamentosSemAviso();
        checarLembretes();
      })().catch((erro) =>
        console.error("[RECONCILIAÇÃO] Erro ao retomar pendências após conectar:", erro.message));
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (geracao !== geracaoConexao) return;
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

      if (!permitirMensagemDoTelefone(telefone)) {
        if (deveAvisarLimiteDeTaxa(telefone)) {
          filaMensagens.enfileirar(telefone, async () => {
            const conexao = sockAtivo;
            if (conexao) await reenviarPendentesDoTelefone(conexao, telefone);
            return processarFormatoNaoEntendido(conexao, jid, telefone, "taxa");
          }).catch((erro) => console.error("[LIMITE] Erro ao avisar a família:", erro.message));
        }
        continue;
      }

      // Desembrulha ANTES de qualquer decisão. Mensagem temporária, ver uma vez e documento
      // com legenda vêm com o conteúdo de verdade uma camada abaixo, então olhar msg.message
      // direto fazia até o áudio de quem usa mensagem temporária passar batido.
      const conteudo = (typeof normalizeMessageContent === "function"
        ? normalizeMessageContent(msg.message)
        : msg.message) || msg.message;

      if (conteudo.audioMessage) {
        filaMensagens.enfileirar(telefone, async () => {
          const conexao = sockAtivo;
          if (conexao) await reenviarPendentesDoTelefone(conexao, telefone);
          return processarAudioRecebido(conexao, jid, telefone);
        }).catch((erro) => {
          console.error("Erro ao processar áudio:", erro.message);
        });
        continue;
      }

      const texto = TextoDaMensagem.textoDe(conteudo);

      // NADA MAIS SOME EM SILÊNCIO. Antes era `if (!texto.trim()) continue;` e pronto: no
      // pm2 logs não aparecia nem que a mensagem tinha chegado, então uma família invisível
      // era indistinguível de uma família que nunca escreveu.
      if (!texto.trim()) {
        if (TextoDaMensagem.ehRecadoDeSistema(conteudo)) continue;
        if (TextoDaMensagem.ehMidiaSemTexto(conteudo)) {
          console.log(`[MÍDIA SEM TEXTO] ${telefone}: ${TextoDaMensagem.tipoDe(conteudo)} — pedindo descrição em texto.`);
          filaMensagens.enfileirar(telefone, async () => {
            const conexao = sockAtivo;
            if (conexao) await reenviarPendentesDoTelefone(conexao, telefone);
            return processarFormatoNaoEntendido(conexao, jid, telefone, "midia");
          }).catch((erro) => console.error("Erro ao processar mídia:", erro.message));
          continue;
        }
        console.warn(`[SEM TEXTO] ${telefone}: não consegui ler o texto de uma mensagem do tipo ${TextoDaMensagem.tipoDe(conteudo)}.`);
        filaMensagens.enfileirar(telefone, async () => {
          const conexao = sockAtivo;
          if (conexao) await reenviarPendentesDoTelefone(conexao, telefone);
          return processarFormatoNaoEntendido(conexao, jid, telefone, "desconhecido");
        }).catch((erro) => console.error("Erro ao processar formato desconhecido:", erro.message));
        continue;
      }

      console.log(`[RECEBIDA] ${telefone} (jid: ${jid}): ${texto}`);
      agendarProcessamento(jid, telefone, texto);
    }
  });
}

iniciarTravaInstancia();
iniciar().catch((erro) => {
  console.error("[WHATSAPP] Falha inicial de conexão:", erro.message);
  agendarReconexao("falha inicial");
});
