// Painel de acompanhamento e controle da Carla. Roda como um processo PM2 separado
// do bot (carla-painel, não carla-bot) justamente pra continuar de pé mesmo quando
// a Carla estiver desligada — senão não teria como religar ela pela tela.

try { process.loadEnvFile(); } catch { /* a validação obrigatória abaixo explica o que falta */ }

const path = require("path");
const fs = require("fs");
const http = require("http");
const { exec } = require("child_process");
const Seguranca = require(path.join(__dirname, "painel-seguranca.js"));
const StatusWhatsapp = require(path.join(__dirname, "status-whatsapp.js"));

const PAINEL_SENHA = String(process.env.PAINEL_SENHA || "");
if (!PAINEL_SENHA.trim()) {
  throw new Error("PAINEL_SENHA não configurada: o painel recusou iniciar para não abrir sem senha.");
}

const Storage = require(path.join(__dirname, "storage-node.js"));
const { criarIntegracoesDuraveis } = require(path.join(__dirname, "integracoes-duraveis.js"));
const Eventos = require(path.join(__dirname, "registro-de-eventos.js"));
const PainelWebhook = require(path.join(__dirname, "painel-webhook.js"));

// Painel e bot compartilham a mesma caixa de efeitos. O lock e o lease da caixa garantem
// que os dois processos possam reconciliar sem executar o mesmo efeito ao mesmo tempo.
// Assim o painel continua concluindo cancelamentos externos mesmo quando o WhatsApp está
// desligado, sem voltar às chamadas de rede únicas e irrecuperáveis dentro da rota HTTP.
const Integracoes = criarIntegracoesDuraveis({
  aoVincularAppAgendamento: async (slotId, appAgendamentoId) => {
    if (!Storage.definirAppAgendamentoId(slotId, appAgendamentoId)) {
      throw new Error(`Agendamento local ${slotId} não encontrado para vínculo SPI.`);
    }
  },
  aoVincularGoogleEvento: async (slotId, googleEventId) => {
    if (!Storage.definirGoogleEventId(slotId, googleEventId)) {
      throw new Error(`Agendamento local ${slotId} não encontrado para vínculo Google.`);
    }
  },
});

const PORTA = 3355;
const NOME_APP_BOT = "carla-bot";

// windowsHide evita que cada checagem de status abra e feche uma janela de console
// visível no Windows (senão fica "pipocando" uma telinha preta a cada 5 segundos).
function statusDoBot() {
  return new Promise((resolve) => {
    exec("pm2 jlist", { windowsHide: true }, (erro, stdout) => {
      if (erro) return resolve(StatusWhatsapp.resumir({ rodando: false, existe: false, pid: null }));
      try {
        const lista = JSON.parse(stdout);
        const app = lista.find((a) => a.name === NOME_APP_BOT);
        if (!app) return resolve(StatusWhatsapp.resumir({ rodando: false, existe: false, pid: null }));
        resolve(StatusWhatsapp.resumir({
          rodando: app.pm2_env.status === "online",
          existe: true,
          pid: app.pid,
        }));
      } catch {
        resolve(StatusWhatsapp.resumir({ rodando: false, existe: false, pid: null }));
      }
    });
  });
}

// Roda o comando do PM2 com cwd fixo nesta pasta, assim "ecosystem.config.js" resolve
// como caminho relativo e a gente não precisa lidar com espaços/parênteses no caminho.
function rodarComandoPm2(comando) {
  return new Promise((resolve) => {
    exec(comando, { cwd: __dirname, windowsHide: true }, (erro, stdout, stderr) => {
      resolve({ ok: !erro, mensagem: erro ? (stderr || erro.message) : stdout });
    });
  });
}

// Aceita o número digitado em qualquer formato (com espaço, parênteses, com ou sem DDI)
// e devolve sempre no formato que a Carla usa de verdade ("+55..."), assumindo Brasil
// quando não vier DDI — evita silenciar o número errado por causa de formatação.
function normalizarTelefoneManual(bruto) {
  let digitos = String(bruto || "").replace(/\D/g, "");
  if (digitos.length <= 11) digitos = "55" + digitos;
  return "+" + digitos;
}

const LIMITE_CORPO = Seguranca.inteiroPositivo(
  process.env.PAINEL_LIMITE_CORPO_BYTES, Seguranca.LIMITE_CORPO_PADRAO, 1024 * 1024
);
const lerCorpoJSON = (req) => Seguranca.lerCorpo(req, { limite: LIMITE_CORPO, json: true });
const lerCorpoTexto = (req) => Seguranca.lerCorpo(req, { limite: LIMITE_CORPO, json: false });

// Login persistente: depois de autenticar uma vez (com a senha via Basic Auth), o navegador
// recebe um token aleatório. Ele só vale na memória deste processo, nunca é derivado da senha
// e expira; reiniciar o painel encerra todas as sessões existentes.
const NOME_COOKIE = "carla_painel_sessao";
const SESSAO_SEGUNDOS = Seguranca.inteiroPositivo(
  process.env.PAINEL_SESSAO_SEGUNDOS, 7 * 24 * 60 * 60, 60 * 24 * 60 * 60
);
const sessoes = Seguranca.criarSessoes({
  nomeCookie: NOME_COOKIE, ttlMs: SESSAO_SEGUNDOS * 1000,
});
const limiteLogin = Seguranca.criarLimitador({ maximo: 10, janelaMs: 15 * 60 * 1000 });
const limiteApi = Seguranca.criarLimitador({ maximo: 240, janelaMs: 60 * 1000 });
const limiteWebhook = Seguranca.criarLimitador({ maximo: 60, janelaMs: 60 * 1000 });

const html = fs.readFileSync(path.join(__dirname, "dashboard.html"));
const PASTA_ICONES = path.join(__dirname, "icons");

// Repassa pro bot o aviso de que o Dr. Bruno liberou o portal de uma criança no
// prontuário. Vem antes da checagem de senha de propósito: quem chama é máquina, não
// navegador, e ela se identifica pelo segredo combinado, não pela senha do painel.
//
// O painel não consegue mandar WhatsApp (a conexão vive no processo do bot), então aqui
// ele só encaminha pra porta interna do bot, que escuta só em 127.0.0.1.
//
// Inerte sem PORTAL_WEBHOOK_SECRET: sem segredo configurado a rota recusa tudo, em vez
// de virar um jeito de qualquer um da internet fazer a Carla mandar mensagem.
const PORTA_INTERNA_BOT = 3357;

// Um encaminhador para os dois avisos (portal e guia): só o caminho muda, e duplicar
// significaria consertar timeout, erro de conexão e Content-Length em dois lugares.
function encaminharAoBot(caminho, corpo) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: "127.0.0.1", port: PORTA_INTERNA_BOT, path: caminho,
      method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(corpo) },
      timeout: 15000,
    }, (resposta) => {
      let texto = "";
      resposta.on("data", (p) => { texto += p; });
      resposta.on("end", () => resolve({ status: resposta.statusCode, texto }));
    });
    req.on("timeout", () => req.destroy(new Error("Timeout")));
    req.on("error", (erro) => resolve({ status: 503, texto: JSON.stringify({ ok: false, motivo: "Carla fora do ar: " + erro.message }) }));
    req.write(corpo);
    req.end();
  });
}

async function enfileirarCancelamentoDuravel(agendamento) {
  await Promise.all([
    Integracoes.agendarCancelamentoSpi({
      slotId: agendamento.slotId,
      appAgendamentoId: agendamento.appAgendamentoId || null,
    }),
    Integracoes.agendarCancelamentoGoogle({
      slotId: agendamento.slotId,
      eventId: agendamento.googleEventId || null,
    }),
  ]);
  if (!Storage.marcarCancelamentoEnfileirado(agendamento.slotId, { spi: true, google: true })) {
    throw new Error(`Cancelamento local ${agendamento.slotId} não encontrado para confirmar a fila.`);
  }
}

// Se o processo cair depois do COMMIT no SQLite e antes de terminar as duas gravações da
// caixa, o registro cancelado continua marcado como pendente. Este varredor fecha a janela
// na volta do painel. Repetições são seguras porque cada integração usa uma chave por slot.
let recuperandoCancelamentos = false;
async function recuperarCancelamentosNaoEnfileirados() {
  if (recuperandoCancelamentos) return;
  recuperandoCancelamentos = true;
  try {
    for (const agendamento of Storage.listarCancelamentosPendentesDeFila()) {
      try {
        await enfileirarCancelamentoDuravel(agendamento);
      } catch (erro) {
        console.error(`[CANCELAMENTO] Não consegui enfileirar as integrações de ${agendamento.slotId}:`, erro.message);
      }
    }
  } finally {
    recuperandoCancelamentos = false;
  }
}

async function atenderRequisicao(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");

  const cliente = Seguranca.identificarCliente(req);
  const caminhoPedido = new URL(req.url, "http://painel.local").pathname;
  if (caminhoPedido.startsWith("/webhook/")) {
    const limite = limiteWebhook.verificar(cliente);
    if (!limite.permitido) {
      res.writeHead(429, { "Content-Type": "application/json; charset=utf-8", "Retry-After": limite.tentarEm });
      res.end(JSON.stringify({ ok: false, motivo: "Muitas tentativas. Tente novamente depois." }));
      return;
    }
  }

  // Porta de máquina (prontuário -> Carla). A decisão de quem entra vive em
  // painel-webhook.js, que é módulo puro e testado; aqui só sobra o encanamento.
  const decisao = PainelWebhook.decidir({
    url: req.url, method: req.method, headers: req.headers, env: process.env,
  });
  if (decisao.tipo === "recusar") {
    res.writeHead(decisao.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(decisao.corpo));
    return;
  }
  if (decisao.tipo === "encaminhar") {
    const corpo = await lerCorpoTexto(req);
    const r = await encaminharAoBot(decisao.caminho, corpo || "{}");
    res.writeHead(r.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(r.texto);
    return;
  }

  const autenticacao = sessoes.autenticar(req, PAINEL_SENHA);
  if (!autenticacao.ok) {
    const limite = limiteLogin.verificar(cliente);
    const status = limite.permitido ? 401 : 429;
    const cabecalhos = limite.permitido
      ? { "WWW-Authenticate": 'Basic realm="Painel da Carla"' }
      : { "Retry-After": limite.tentarEm };
    res.writeHead(status, cabecalhos);
    res.end(limite.permitido ? "Senha necessária." : "Muitas tentativas. Aguarde e tente novamente.");
    return;
  }
  limiteLogin.limpar(cliente);

  if (!["GET", "HEAD", "OPTIONS"].includes(String(req.method || "").toUpperCase()) &&
      caminhoPedido.startsWith("/api/") && !Seguranca.origemPermitida(req)) {
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, erro: "Origem da operação recusada." }));
    return;
  }

  if (caminhoPedido.startsWith("/api/")) {
    const limite = limiteApi.verificar(cliente);
    res.setHeader("X-RateLimit-Remaining", limite.restante);
    if (!limite.permitido) {
      res.writeHead(429, { "Content-Type": "application/json; charset=utf-8", "Retry-After": limite.tentarEm });
      res.end(JSON.stringify({ ok: false, erro: "Muitas operações. Aguarde um minuto." }));
      return;
    }
  }

  // Renova o cookie de sessão a cada acesso autenticado (sliding expiration) — enquanto
  // usar o painel de tempos em tempos, nunca chega a expirar e pedir senha de novo.
  res.setHeader("Set-Cookie", Seguranca.cookieSeguro(
    NOME_COOKIE, autenticacao.token, SESSAO_SEGUNDOS
  ));

  if (req.url === "/manifest.json") {
    res.writeHead(200, { "Content-Type": "application/manifest+json; charset=utf-8" });
    res.end(fs.readFileSync(path.join(__dirname, "manifest.json")));
    return;
  }

  // Service worker — necessário pro navegador oferecer "Instalar" o painel como app.
  if (req.url === "/sw.js") {
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
    res.end(fs.readFileSync(path.join(__dirname, "sw.js")));
    return;
  }

  // path.basename corta qualquer ".." do pedido — só serve arquivo que já existe
  // dentro da pasta icons/, nunca deixa escapar pra ler outro arquivo do projeto.
  if (req.url.startsWith("/icons/")) {
    const arquivo = path.join(PASTA_ICONES, path.basename(req.url));
    if (arquivo.startsWith(PASTA_ICONES) && fs.existsSync(arquivo)) {
      const ext = path.extname(arquivo).toLowerCase();
      const tipo = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
        : ext === ".webp" ? "image/webp"
        : ext === ".svg" ? "image/svg+xml"
        : "image/png";
      res.writeHead(200, { "Content-Type": tipo });
      res.end(fs.readFileSync(arquivo));
    } else {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  // O FUNIL. Lê o registro de eventos (data/eventos.jsonl) e devolve já agregado, porque
  // agregar no navegador significaria mandar o arquivo inteiro pra tela a cada 5 segundos.
  //
  // A conversão que sai daqui é a da BASE PARTICULAR, não a de todo mundo: quem chega
  // perguntando de convênio nunca foi lead particular, e contar junto faz a conversão
  // parecer pior do que é. O anel do painel passou a beber desta mesma fonte pra não
  // existirem dois números diferentes na mesma tela.
  // Caminho EXATO, não startsWith: com startsWith esta rota engoliria /api/funil.csv e o
  // download nunca aconteceria (peguei isso acontecendo aqui).
  if (new URL(req.url, "http://x").pathname === "/api/funil") {
    const periodo = new URL(req.url, "http://x").searchParams.get("periodo") || "30d";
    const { desde, ate, rotulo } = Eventos.periodoPara(periodo);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    const f = Eventos.funil({ desde, ate });
    // A lista de contatos crus não vai pro navegador: ela cresce sem teto e a tela não usa.
    res.end(JSON.stringify({ ...f, contatos: undefined, periodo, rotulo }));
    return;
  }

  // A planilha, pronta. É o que substitui alguém preenchendo à mão.
  if (new URL(req.url, "http://x").pathname === "/api/funil.csv") {
    const periodo = new URL(req.url, "http://x").searchParams.get("periodo") || "30d";
    const { desde, ate } = Eventos.periodoPara(periodo);
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="funil-${periodo}.csv"`,
    });
    res.end(Eventos.csv({ desde, ate }));
    return;
  }

  if (req.url === "/api/dados") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      agendamentos: Storage.lerAgendamentos(),
      alertas: Storage.lerAlertas(),
      bloqueios: Storage.lerBloqueios(),
      contatos: Storage.listarTodosContatos(),
      metricas: Storage.metricasConversao(),
      silenciados: Storage.lerContatosSilenciados(),
    }));
    return;
  }

  // Botão "portal" da lista de agendamentos: o Dr. Bruno liberou o acesso no prontuário,
  // toca aqui e a Carla manda o link pra família. Quem manda a mensagem é o processo do
  // bot (a conexão do WhatsApp vive lá), então isto só encaminha pra porta interna dele.
  if (req.url === "/api/avisar-portal" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const r = await encaminharAoBot("/interno/portal-liberado", JSON.stringify({ telefone: corpo.telefone }));
    res.writeHead(r.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(r.texto);
    return;
  }

  // Botão "guia" da lista: o Dr. Bruno já liberou o acesso no prontuário, toca aqui e a
  // Carla manda o link. Mesma porta interna do portal — a conexão do WhatsApp vive no
  // processo do bot, não aqui.
  if (req.url === "/api/avisar-guia" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const r = await encaminharAoBot("/interno/guia-liberado", JSON.stringify({ telefone: corpo.telefone }));
    res.writeHead(r.status, { "Content-Type": "application/json" });
    res.end(r.texto);
    return;
  }

  if (req.url === "/api/bloqueio-toggle" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const bloqueios = corpo.data ? Storage.alternarBloqueioDia(corpo.data) : Storage.lerBloqueios();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, bloqueios }));
    return;
  }

  if (req.url.startsWith("/api/horarios-do-dia") && req.method === "GET") {
    const data = new URL(req.url, "http://localhost").searchParams.get("data");
    const resultado = data ? Storage.listarHorariosDoDia(data) : { diaTodoBloqueado: false, horarios: [] };
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(resultado));
    return;
  }

  if (req.url === "/api/bloqueio-horario-toggle" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const bloqueiosHorarios = corpo.slotId ? Storage.alternarBloqueioHorario(corpo.slotId) : Storage.lerBloqueiosHorarios();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, bloqueiosHorarios }));
    return;
  }

  // Libera um horário fora da grade padrão (ex: uma sexta à tarde). Valida data e hora
  // aqui, no servidor — o painel nunca é a única barreira contra um valor esquisito.
  // O Dr. Bruno respondendo Sim ou Não a uma pergunta que a Carla fez. Ele não assume a
  // conversa: responde aqui e ela continua sozinha, do outro lado.
  //
  // Quando a pergunta é sobre abrir um horário que a grade não tem, o alerta carrega a data e
  // a hora, e o SIM cria o horário extra ANTES de avisar o bot. Sem isso a Carla prometeria um
  // horário que a ferramenta ia recusar na hora de marcar, que é pior que ter dito não.
  if (req.url === "/api/responder-escalada" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const alerta = corpo.alertaId ? Storage.acharAlerta(corpo.alertaId) : null;
    const resposta = typeof corpo.resposta === "string" ? corpo.resposta.trim() : "";
    if (!alerta || !alerta.pergunta || !resposta) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, erro: "Alerta sem pergunta, ou resposta vazia." }));
      return;
    }

    // "sim" cru é o botão; qualquer texto que o Dr. Bruno escreva à mão NÃO abre horário
    // nenhum, porque aí ele pode estar dizendo "só depois do dia 20" e abrir seria errado.
    const ehSim = resposta.toLowerCase() === "sim";
    let horarioAberto = null;
    if (ehSim && alerta.dataPedida && alerta.horaPedida) {
      Storage.adicionarHorarioExtra(alerta.dataPedida, alerta.horaPedida);
      horarioAberto = `${alerta.dataPedida} ${alerta.horaPedida}`;
    }

    const r = await encaminharAoBot("/interno/resposta-do-doutor",
      JSON.stringify({ alertaId: alerta.id, resposta }));
    let devolvido = {};
    try { devolvido = JSON.parse(r.texto || "{}"); } catch { devolvido = { ok: false, motivo: "Resposta inesperada do bot." }; }
    res.writeHead(r.status === 200 ? 200 : 422, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ...devolvido, horarioAberto }));
    return;
  }

  if (req.url === "/api/horario-extra" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const data = typeof corpo.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(corpo.data) ? corpo.data : null;
    const hora = typeof corpo.hora === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(corpo.hora) ? corpo.hora : null;
    if (!data || !hora) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, erro: "Data ou hora inválida." }));
      return;
    }
    Storage.adicionarHorarioExtra(data, hora);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, horarios: Storage.listarHorariosDoDia(data) }));
    return;
  }

  if (req.url === "/api/horario-extra-remover" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    if (corpo.slotId) Storage.removerHorarioExtra(corpo.slotId);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Botão "reaquecer" da lista de contatos. Quem manda a mensagem é o bot (a conexão do
  // WhatsApp vive lá), então isto só encaminha, igual aos avisos do portal e do guia.
  //
  // NÃO existe versão em lote aqui, de propósito. A Carla roda num cliente NÃO OFICIAL do
  // WhatsApp, e disparo em massa pra quem parou de responder é o padrão clássico de
  // banimento. Um botão por vez, com o dedo do Dr. Bruno no gatilho, é o que mantém isso
  // seguro enquanto ainda não se sabe se a mensagem funciona.
  if (req.url === "/api/reaquecer" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const r = await encaminharAoBot("/interno/reaquecer", JSON.stringify({ telefone: corpo.telefone }));
    res.writeHead(r.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(r.texto);
    return;
  }

  if (req.url === "/api/silenciar" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const telefone = corpo.telefone ? normalizarTelefoneManual(corpo.telefone) : null;
    const silenciados = telefone ? Storage.silenciarContato(telefone) : Storage.lerContatosSilenciados();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, silenciados }));
    return;
  }

  if (req.url === "/api/dessilenciar" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const silenciados = corpo.telefone ? Storage.dessilenciarContato(corpo.telefone) : Storage.lerContatosSilenciados();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, silenciados }));
    return;
  }

  // Marcar/desmarcar pago. Uma rota só, com o estado desejado no corpo, porque o botão é
  // um interruptor: o clique errado na lista precisa poder ser desfeito no clique seguinte.
  if (req.url === "/api/pagamento-toggle" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const pago = !!corpo.pago;
    const alteracao = corpo.slotId
      ? Storage.alterarPagamento(corpo.slotId, pago)
      : { ok: false, alterado: false, agendamento: null };
    const ok = alteracao.ok;

    // O arquivo continua append-only: desmarcar grava um evento compensatório. O agregador
    // aplica os eventos na ordem e, assim, o painel mostra o estado final sem apagar a
    // trilha de auditoria nem continuar contando como pago um clique que foi corrigido.
    if (ok && alteracao.alterado && alteracao.agendamento) {
      Eventos.registrar(pago ? "pagou" : "pagamento_desmarcado",
        alteracao.agendamento.telefone, { slotId: corpo.slotId });
    }

    // Marcar como pago é o gatilho da confirmação: é o Dr. Bruno dizendo que viu o dinheiro
    // no extrato, e é o único momento em que a família pode ouvir que a consulta está
    // confirmada. Desmarcar não desfaz mensagem nenhuma — o que já foi enviado foi.
    //
    // O painel não manda WhatsApp (a conexão vive no processo do bot), então encaminha pra
    // porta interna, igual aos avisos do portal e do guia.
    let avisou = null;
    if (ok && pago && (alteracao.alterado || !alteracao.agendamento?.pagamentoAvisadoEm)) {
      const r = await encaminharAoBot("/interno/pagamento-confirmado", JSON.stringify({ slotId: corpo.slotId }));
      try { avisou = JSON.parse(r.texto); } catch { avisou = { ok: false, motivo: r.texto }; }
      if (!avisou.ok) console.error(`[PAGAMENTO] Não avisei a família de ${corpo.slotId}: ${r.texto}`);
    }

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok, alterado: alteracao.alterado, avisou }));
    return;
  }

  if (req.url === "/api/marcar-paciente" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const telefone = corpo.telefone ? normalizarTelefoneManual(corpo.telefone) : null;
    const pacientes = telefone ? Storage.marcarPacienteManual(telefone) : Storage.lerPacientesManuais();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, pacientesManuais: pacientes }));
    return;
  }

  if (req.url === "/api/desmarcar-paciente" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const pacientes = corpo.telefone ? Storage.desmarcarPacienteManual(corpo.telefone) : Storage.lerPacientesManuais();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, pacientesManuais: pacientes }));
    return;
  }

  if (req.url === "/api/retomar-atendimento" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const ok = corpo.telefone ? Storage.retomarAtendimento(corpo.telefone) : false;
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok }));
    return;
  }

  if (req.url === "/api/limpar-conversa" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    if (corpo.telefone) Storage.limparConversa(corpo.telefone);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url === "/api/status") {
    const status = await statusDoBot();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(status));
    return;
  }

  if (req.url === "/api/ligar" && req.method === "POST") {
    const resultado = await rodarComandoPm2(`pm2 start ecosystem.config.js --only ${NOME_APP_BOT}`);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(resultado));
    return;
  }

  if (req.url === "/api/desligar" && req.method === "POST") {
    const resultado = await rodarComandoPm2(`pm2 stop ${NOME_APP_BOT}`);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(resultado));
    return;
  }

  if (req.url === "/api/cancelar" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const removido = corpo.slotId ? Storage.cancelarAgendamento(corpo.slotId) : null;
    let integracoesEnfileiradas = false;
    if (removido) {
      try {
        await enfileirarCancelamentoDuravel(removido);
        integracoesEnfileiradas = true;
      } catch (erro) {
        // O cancelamento local já está confirmado. Não mentimos que ele falhou: o varredor
        // acima encontra o marcador ausente e repete o enfileiramento automaticamente.
        console.error(`[CANCELAMENTO] Cancelado localmente, fila externa pendente para ${removido.slotId}:`, erro.message);
      }
    }
    // Se a Carla tinha em cache "essa conversa já tem consulta marcada" pra esse
    // telefone, apaga o cache — senão ela continua achando que ainda está marcada
    // mesmo depois de cancelada aqui pela tela (não passa por cancelar_agendamento).
    if (removido && removido.telefone) {
      const sessao = Storage.obterSessao(removido.telefone);
      if (sessao && sessao.ultimoAgendamento && sessao.ultimoAgendamento.label === removido.diaLabel) {
        sessao.ultimoAgendamento = null;
        Storage.salvarSessao(removido.telefone, sessao);
      }
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: !!removido, integracoesEnfileiradas }));
    return;
  }

  if (req.url === "/api/limpar-alertas" && req.method === "POST") {
    Storage.limparAlertas();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

const servidor = http.createServer((req, res) => {
  atenderRequisicao(req, res).catch((erro) => {
    if (res.writableEnded) return;
    const status = Number(erro && erro.statusCode) || 500;
    if (status >= 500) console.error("[PAINEL] Falha interna ao atender requisição:", erro);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, erro: status >= 500 ? "Erro interno." : erro.message }));
  });
});

servidor.on("error", (erro) => {
  if (erro.code === "EADDRINUSE") {
    console.error(`\nJá existe algo usando a porta ${PORTA} — o painel provavelmente já está aberto.\n`);
    process.exit(1);
  }
  throw erro;
});

servidor.listen(PORTA, "127.0.0.1", () => {
  console.log(`Painel da Carla disponível em: http://localhost:${PORTA}`);
});

// O reconciliador executa fora das rotas HTTP. O clique só persiste e enfileira; queda de
// rede, timeout ou reinício ficam registrados para nova tentativa. Pode coexistir com o
// reconciliador do bot porque a caixa concede um lease exclusivo por efeito.
Integracoes.iniciarReconciliacao();
void recuperarCancelamentosNaoEnfileirados();
const timerRecuperarCancelamentos = setInterval(recuperarCancelamentosNaoEnfileirados, 60_000);
if (typeof timerRecuperarCancelamentos.unref === "function") timerRecuperarCancelamentos.unref();
