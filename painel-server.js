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
const Crm = require(path.join(__dirname, "crm.js"));

// Notas e etiquetas do CRM. Arquivo próprio, fora do SQLite e das sessões: é anotação do
// Dr. Bruno, não estado da Carla, e limpar uma conversa não pode apagar o que ele escreveu.
const ARQ_CRM = path.join(__dirname, "data", "crm.json");
const LINK_AVALIACAO = String(process.env.LINK_AVALIACAO_GOOGLE || "").trim() || null;

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

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// O comando do PM2 terminar não basta: o painel só confirma a ação depois de reler o estado
// real do processo. Antes, qualquer falha (inclusive um clique durante o restart do painel)
// era devolvida como HTTP 200 e o navegador a ignorava, dando a impressão de que ligou.
async function controlarBot(deveRodar) {
  const acao = deveRodar ? "ligar" : "desligar";
  const comando = deveRodar
    ? `pm2 start ecosystem.config.js --only ${NOME_APP_BOT} --update-env`
    : `pm2 stop ${NOME_APP_BOT}`;
  const executado = await rodarComandoPm2(comando);
  if (!executado.ok) {
    console.error(`[PAINEL] Falha do PM2 ao ${acao} a Carla:`, executado.mensagem);
    return { ok: false, erro: `Não foi possível ${acao} a Carla no servidor.` };
  }

  let status = await statusDoBot();
  for (let tentativa = 0; status.rodando !== deveRodar && tentativa < 10; tentativa++) {
    await esperar(300);
    status = await statusDoBot();
  }
  if (status.rodando !== deveRodar) {
    console.error(`[PAINEL] O PM2 não confirmou a ação de ${acao}.`, status);
    return { ok: false, erro: `O servidor não confirmou que conseguiu ${acao} a Carla.`, status };
  }

  const persistido = await rodarComandoPm2("pm2 save");
  if (!persistido.ok) console.error("[PAINEL] Estado alterado, mas o PM2 não conseguiu salvá-lo:", persistido.mensagem);
  console.log(`[PAINEL] Carla ${deveRodar ? "ligada" : "desligada"} pelo painel; estado confirmado no PM2.`);
  return { ok: true, status };
}

const LIMITE_CORPO = Seguranca.inteiroPositivo(
  process.env.PAINEL_LIMITE_CORPO_BYTES, Seguranca.LIMITE_CORPO_PADRAO, 1024 * 1024
);
const lerCorpoJSON = (req) => Seguranca.lerCorpo(req, { limite: LIMITE_CORPO, json: true });
const lerCorpoTexto = (req) => Seguranca.lerCorpo(req, { limite: LIMITE_CORPO, json: false });

// Login persistente: a página própria de senha funciona também no Safari/PWA do iPhone,
// que pode transformar uma resposta Basic 401 sem tipo em arquivo para download. Basic Auth
// fica restrito ao health check interno, mas não é mais a interface de login humana.
// Depois de autenticar, o navegador recebe um token aleatório que só vale na memória deste
// processo, nunca é derivado da senha e expira; reiniciar o painel encerra as sessões.
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

function paginaLogin(mensagem = "") {
  const aviso = mensagem
    ? `<p class="aviso" role="alert">${mensagem}</p>`
    : '<p class="instrucao">Digite a senha para abrir o painel.</p>';
  return Buffer.from(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0a2129">
  <title>Entrar · Carla CRM</title>
  <style>
    @font-face { font-family: "Montserrat"; font-style: normal; font-weight: 100 900; font-display: swap;
      src: url(/fontes/montserrat.woff2) format("woff2"); }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
      background: linear-gradient(180deg, #0a2129 0%, #071921 45%, #020a0e 100%); background-color: #020a0e; color: #a9bcc2;
      font-family: "Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(100%, 390px); padding: 30px 24px; border: 1px solid #414a4c;
      border-radius: 22px; background: #0a2129; box-shadow: 0 20px 60px #0008; }
    h1 { margin: 0 0 8px; font-size: 27px; font-weight: 700; color: #fcf4e8; }
    p { margin: 0 0 22px; color: #a9bcc2; line-height: 1.45; }
    .aviso { color: #ffb4ab; }
    label { display: block; margin-bottom: 8px; font-size: 12px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: #8fbacb; }
    input { width: 100%; min-height: 50px; padding: 12px 14px; border: 1px solid rgba(250,221,124,0.35);
      border-radius: 13px; background: #06161c; color: #fcf4e8; font-size: 18px; font-family: inherit; outline: none; }
    input:focus { border-color: #fadd7d; box-shadow: 0 0 0 3px #fadd7d33; }
    button { width: 100%; min-height: 50px; margin-top: 16px; border: 0; border-radius: 13px; font-family: inherit;
      background: linear-gradient(135deg, #fbde7e, #dbb85f); color: #0a2129; font-size: 17px; font-weight: 700; letter-spacing: 0.06em; }
  </style>
</head>
<body>
  <main>
    <h1>Carla CRM</h1>
    ${aviso}
    <form method="post" action="/login">
      <label for="senha">Senha</label>
      <input id="senha" name="senha" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Entrar</button>
    </form>
  </main>
</body>
</html>`, "utf8");
}

function enviarPaginaLogin(res, { status = 200, mensagem = "", tentarEm = null } = {}) {
  const corpo = paginaLogin(mensagem);
  const cabecalhos = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": corpo.length,
  };
  if (tentarEm) cabecalhos["Retry-After"] = tentarEm;
  res.writeHead(status, cabecalhos);
  res.end(corpo);
}

function redirecionar(res, destino) {
  res.writeHead(303, { Location: destino, "Content-Type": "text/plain; charset=utf-8" });
  res.end("Redirecionando...");
}

const html = fs.readFileSync(path.join(__dirname, "dashboard.html"));
const PASTA_ICONES = path.join(__dirname, "icons");
const ARQUIVO_FONTE = path.join(__dirname, "fontes", "montserrat.woff2");

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

// O que a aba Famílias mostra como "Paciente", pela MESMA montagem que pinta a etiqueta:
// marcado no botão, salvo com nome no celular do Dr. Bruno ou com consulta realizada
// registrada. É esta lista que a conversão tem que bater, número por número.
function pacientesDoPainel() {
  const crm = Crm.montarCrm({
    contatos: Storage.listarTodosContatos(),
    agendamentos: Storage.lerTodosAgendamentos(),
    funilContatos: [],
    dadosCrm: Crm.lerCrm(ARQ_CRM),
  });
  return crm.contatos.filter((c) => c.ehPaciente).map((c) => c.telefone);
}

// Todo paciente do painel sem conversão vigente ganha o evento agora. Roda ao subir, de
// tempos em tempos e antes de responder o funil; é idempotente, porque só entra quem ainda
// não tem virou_paciente vigente. Já falhou duas vezes por ser estreita demais (só o botão;
// depois só quem tinha sessão), então a regra agora é literal: paciente no painel = conversão.
function reconciliarConversoesDePacientes() {
  try {
    const pendentes = Crm.pacientesSemConversao({
      pacientes: pacientesDoPainel(),
      sessoes: Storage.lerSessoes(),
      eventos: Eventos.lerEventos({}),
    });
    for (const p of pendentes) Eventos.registrar("virou_paciente", p.telefone, { origem: "retroativo" }, p.em);
    if (pendentes.length) console.log(`[CRM] ${pendentes.length} paciente(s) do painel sem conversão ganharam a conversão retroativa.`);
    return pendentes.length;
  } catch (erro) {
    console.error("[CRM] Não consegui reconciliar as conversões de pacientes:", erro.message);
    return 0;
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

  // A fonte do painel (Montserrat) mora no repositorio e sai daqui mesmo: o CSP so
  // aceita origem propria, e a tela de entrar tambem a usa, por isso fica antes da senha.
  if (caminhoPedido === "/fontes/montserrat.woff2" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=31536000, immutable" });
    res.end(fs.readFileSync(ARQUIVO_FONTE));
    return;
  }

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

  // Basic Auth só existe para o health check local do deploy. A tentativa é limitada ANTES
  // de comparar a senha; limitar depois deixaria um atacante continuar testando senhas e
  // apenas esconderia a resposta. Todas as páginas humanas usam cookie + formulário.
  const basicSaude = caminhoPedido === "/api/status" && req.method === "GET" &&
    String(req.headers.authorization || "").startsWith("Basic ");
  if (basicSaude) {
    const limite = limiteLogin.verificar(cliente);
    if (!limite.permitido) {
      res.writeHead(429, {
        "Content-Type": "application/json; charset=utf-8",
        "Retry-After": limite.tentarEm,
      });
      res.end(JSON.stringify({ ok: false, erro: "Muitas tentativas. Aguarde e tente novamente." }));
      return;
    }
  }
  const autenticacao = sessoes.autenticar(req, PAINEL_SENHA, { permitirBasic: basicSaude });

  if (caminhoPedido === "/login" && req.method === "GET") {
    if (autenticacao.ok) {
      limiteLogin.limpar(cliente);
      res.setHeader("Set-Cookie", Seguranca.cookieSeguro(
        NOME_COOKIE, autenticacao.token, SESSAO_SEGUNDOS
      ));
      redirecionar(res, "/");
      return;
    }
    enviarPaginaLogin(res);
    return;
  }

  if (caminhoPedido === "/login" && req.method === "POST") {
    if (!Seguranca.origemLoginPermitida(req)) {
      enviarPaginaLogin(res, { status: 403, mensagem: "Esta tentativa de entrada foi recusada." });
      return;
    }
    const limite = limiteLogin.verificar(cliente);
    if (!limite.permitido) {
      enviarPaginaLogin(res, {
        status: 429,
        mensagem: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
        tentarEm: limite.tentarEm,
      });
      return;
    }
    const parametros = new URLSearchParams(await lerCorpoTexto(req));
    const entrada = sessoes.entrar(parametros.get("senha"), PAINEL_SENHA);
    if (!entrada.ok) {
      enviarPaginaLogin(res, { status: 401, mensagem: "Senha incorreta." });
      return;
    }
    limiteLogin.limpar(cliente);
    res.setHeader("Set-Cookie", Seguranca.cookieSeguro(
      NOME_COOKIE, entrada.token, SESSAO_SEGUNDOS
    ));
    redirecionar(res, "/");
    return;
  }

  if (!autenticacao.ok) {
    const navegacao = String(req.headers["sec-fetch-mode"] || "").toLowerCase() === "navigate";
    if (caminhoPedido.startsWith("/api/") && !navegacao) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, erro: "Sessão expirada.", login: "/login" }));
      return;
    }
    redirecionar(res, "/login");
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
    // Antes de contar, garante que todo paciente do painel já é conversão: assim o número
    // bate com a aba Famílias na hora em que a tela abre, sem esperar o timer.
    reconciliarConversoesDePacientes();
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

  // O CRM. Cruza contatos, consultas (inclusive as passadas), funil, notas e etiquetas e
  // devolve cada família já com a situação escrita. O cruzamento é aqui, não no navegador,
  // pelo mesmo motivo do funil: a lista de eventos cresce sem teto.
  if (caminhoPedido === "/api/crm" && req.method === "GET") {
    const crm = Crm.montarCrm({
      contatos: Storage.listarTodosContatos(),
      agendamentos: Storage.lerTodosAgendamentos(),
      funilContatos: Eventos.funil({}).contatos,
      dadosCrm: Crm.lerCrm(ARQ_CRM),
    });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ...crm, temLinkAvaliacao: !!LINK_AVALIACAO }));
    return;
  }

  // A ficha de uma família: consultas, últimas mensagens, linha do tempo, notas, etiquetas
  // e os modelos de pós-consulta já preenchidos com o nome da criança e do responsável.
  if (caminhoPedido === "/api/crm/contato" && req.method === "GET") {
    const telefone = new URL(req.url, "http://x").searchParams.get("telefone") || "";
    if (!telefone) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, erro: "Sem telefone." }));
      return;
    }
    const dadosCrm = Crm.lerCrm(ARQ_CRM);
    const crm = Crm.montarCrm({
      contatos: Storage.listarTodosContatos().filter((c) => c.telefone === telefone),
      agendamentos: Storage.lerTodosAgendamentos().filter((a) => a.telefone === telefone),
      funilContatos: Eventos.funil({}).contatos.filter((c) => c.telefone === telefone),
      dadosCrm,
    });
    const contato = crm.contatos[0] || null;
    if (!contato) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, erro: "Contato não encontrado." }));
      return;
    }
    const consultas = Crm.todasAsConsultas(Storage.lerTodosAgendamentos(), dadosCrm, telefone);
    const notas = dadosCrm.notas[telefone] || [];
    const eventos = Eventos.lerEventos({}).filter((e) => e.telefone === telefone);
    const sessao = Storage.obterSessao(telefone);
    const ultimaConsulta = consultas.find((c) => c.estado === "pago" || c.estado === "reservado") || consultas[0] || null;
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      ok: true,
      contato,
      consultas,
      notas,
      etiquetas: dadosCrm.etiquetas[telefone] || [],
      linhaDoTempo: Crm.linhaDoTempo({ eventos, notas, consultasManuais: dadosCrm.consultasRealizadas[telefone] || [], retornosAvisados: dadosCrm.retornos[telefone] || {} }),
      // As últimas falas da conversa, do jeito que a Carla as guarda. É o que responde
      // "onde essa conversa parou?" sem abrir o WhatsApp.
      historico: ((sessao && sessao.historico) || []).slice(-12),
      modelos: Crm.modelosPara({
        responsavel: contato.responsavel || contato.nome || null,
        crianca: (ultimaConsulta && ultimaConsulta.crianca) || (contato.criancas && contato.criancas[0]) || null,
        linkAvaliacao: LINK_AVALIACAO,
        meses: contato.retornoPendente ? contato.retornoPendente.meses : null,
      }),
    }));
    return;
  }

  if (caminhoPedido === "/api/crm/nota" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const r = Crm.adicionarNota(ARQ_CRM, corpo.telefone, corpo.texto);
    res.writeHead(r.ok ? 200 : 400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(r));
    return;
  }

  if (caminhoPedido === "/api/crm/nota-remover" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const r = Crm.removerNota(ARQ_CRM, corpo.telefone, corpo.id);
    res.writeHead(r.ok ? 200 : 404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(r));
    return;
  }

  // Consulta feita fora da Carla: registrada aqui, conta como realizada (pós-consulta e os
  // retornos de 3 e 6 meses passam a contar dela).
  if (caminhoPedido === "/api/crm/consulta-realizada" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const r = Crm.registrarConsultaRealizada(ARQ_CRM, corpo.telefone, { data: corpo.data, crianca: corpo.crianca, tipoConsulta: corpo.tipoConsulta });
    res.writeHead(r.ok ? 200 : 400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(r));
    return;
  }

  if (caminhoPedido === "/api/crm/consulta-realizada-remover" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const r = Crm.removerConsultaRealizada(ARQ_CRM, corpo.telefone, corpo.id);
    res.writeHead(r.ok ? 200 : 404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(r));
    return;
  }

  // O recado de retorno foi mandado (ou dispensado): o aviso daquele marco sai da tela.
  if (caminhoPedido === "/api/crm/retorno-avisado" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const r = Crm.marcarRetornoAvisado(ARQ_CRM, corpo.telefone, corpo.chave, corpo.avisado !== false);
    res.writeHead(r.ok ? 200 : 400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(r));
    return;
  }

  // Reativar consulta vencida ou cancelada. Quem faz é o bot (cria reserva nova e enfileira
  // SPI e Google); isto só encaminha, igual aos outros botões que mexem no mundo.
  if (caminhoPedido === "/api/crm/reativar" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const r = await encaminharAoBot("/interno/reativar-reserva", JSON.stringify({ slotId: corpo.slotId }));
    res.writeHead(r.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(r.texto);
    return;
  }

  if (caminhoPedido === "/api/crm/etiquetas" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    const r = Crm.definirEtiquetas(ARQ_CRM, corpo.telefone, corpo.etiquetas);
    res.writeHead(r.ok ? 200 : 400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(r));
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
    Storage.adicionarHorarioExtra(data, hora, { soTeleconsulta: corpo.soTeleconsulta === true });
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
    const telefone = Seguranca.normalizarTelefoneManual(corpo.telefone);
    if (!telefone) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, erro: "Telefone inválido." }));
      return;
    }
    const silenciados = Storage.silenciarContato(telefone);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, telefone, silenciados }));
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
    const telefone = Seguranca.normalizarTelefoneManual(corpo.telefone);
    if (!telefone) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, erro: "Telefone inválido." }));
      return;
    }
    // Marcar como paciente CONTA COMO CONVERSÃO no funil, no anel e no CRM: é o jeito de o
    // Dr. Bruno dizer "essa eu fechei". Sem exigir sessão: a conversa pode ter sido limpa ou
    // nem ter passado pela Carla, e mesmo assim é paciente dele. Só não grava de novo quem
    // já tem conversão vigente, pra clique repetido não somar.
    const pacientes = Storage.marcarPacienteManual(telefone);
    let contouComoConversao = false;
    if (!Crm.temConversaoVigente(Eventos.lerEventos({}), telefone)) {
      Eventos.registrar("virou_paciente", telefone, { origem: "painel" });
      contouComoConversao = true;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, telefone, pacientesManuais: pacientes, contouComoConversao }));
    return;
  }

  if (req.url === "/api/desmarcar-paciente" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    // Desmarcar grava o evento compensatório: o arquivo continua append-only e o funil
    // aplica os dois na ordem, então a conversão some sem apagar a trilha. Vale pra qualquer
    // conversão vigente (botão, nome salvo ou retroativa), não só pra quem estava no botão.
    const tinhaConversao = !!corpo.telefone && Crm.temConversaoVigente(Eventos.lerEventos({}), corpo.telefone);
    const pacientes = corpo.telefone ? Storage.desmarcarPacienteManual(corpo.telefone) : Storage.lerPacientesManuais();
    if (tinhaConversao) Eventos.registrar("paciente_desmarcado", corpo.telefone, { origem: "painel" });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, pacientesManuais: pacientes }));
    return;
  }

  // Mensagem escrita pelo Dr. Bruno pra uma família. Quem manda é o bot (a conexão do
  // WhatsApp vive lá); isto só encaminha. A Carla cala naquela conversa até ele retomar.
  if (req.url === "/api/mensagem-manual" && req.method === "POST") {
    const corpo = await lerCorpoJSON(req);
    // carlaContinua só vem dos modelos do CRM que esperam uma resposta que a Carla atende
    // (o convite pra rotina). Texto livre continua calando ela, como antes.
    const r = await encaminharAoBot("/interno/mensagem-manual", JSON.stringify({ telefone: corpo.telefone, texto: corpo.texto, carlaContinua: corpo.carlaContinua === true }));
    res.writeHead(r.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(r.texto);
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
    const resultado = await controlarBot(true);
    res.writeHead(resultado.ok ? 200 : 500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(resultado));
    return;
  }

  if (req.url === "/api/desligar" && req.method === "POST") {
    const resultado = await controlarBot(false);
    res.writeHead(resultado.ok ? 200 : 500, { "Content-Type": "application/json; charset=utf-8" });
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
reconciliarConversoesDePacientes();
const timerReconciliarConversoes = setInterval(reconciliarConversoesDePacientes, 10 * 60_000);
if (typeof timerReconciliarConversoes.unref === "function") timerReconciliarConversoes.unref();
void recuperarCancelamentosNaoEnfileirados();
const timerRecuperarCancelamentos = setInterval(recuperarCancelamentosNaoEnfileirados, 60_000);
if (typeof timerRecuperarCancelamentos.unref === "function") timerRecuperarCancelamentos.unref();
