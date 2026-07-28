// Painel de acompanhamento e controle da Carla. Roda como um processo PM2 separado
// do bot (carla-painel, não carla-bot) justamente pra continuar de pé mesmo quando
// a Carla estiver desligada — senão não teria como religar ela pela tela.

try { process.loadEnvFile(); } catch { /* sem .env — painel funciona sem senha, só localmente */ }

const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const { exec } = require("child_process");

const Storage = require(path.join(__dirname, "storage-node.js"));
const GoogleAgenda = require(path.join(__dirname, "google-agenda.js"));
const AppAgenda = require(path.join(__dirname, "app-agenda.js"));

const PORTA = 3355;
const NOME_APP_BOT = "carla-bot";

// windowsHide evita que cada checagem de status abra e feche uma janela de console
// visível no Windows (senão fica "pipocando" uma telinha preta a cada 5 segundos).
function statusDoBot() {
  return new Promise((resolve) => {
    exec("pm2 jlist", { windowsHide: true }, (erro, stdout) => {
      if (erro) return resolve({ rodando: false, existe: false });
      try {
        const lista = JSON.parse(stdout);
        const app = lista.find((a) => a.name === NOME_APP_BOT);
        if (!app) return resolve({ rodando: false, existe: false });
        resolve({ rodando: app.pm2_env.status === "online", existe: true });
      } catch {
        resolve({ rodando: false, existe: false });
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

function lerCorpoJSON(req) {
  return new Promise((resolve) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(corpo || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

// Sem PAINEL_SENHA configurada no .env, mantém como sempre foi (só uso local, sem senha).
// Com senha configurada, exige em qualquer acesso — inclusive local — pra manter só um caminho.
//
// Login persistente: depois de autenticar uma vez (com a senha via Basic Auth), o navegador
// recebe um cookie de sessão que dura 60 dias — assim não pede senha de novo toda hora,
// principalmente no app salvo na tela do celular (que não guarda o Basic Auth como o Safari
// normal guarda). O cookie é só um hash da senha, não a senha em texto puro.
const NOME_COOKIE = "carla_painel_sessao";
const SESSAO_SEGUNDOS = 60 * 24 * 60 * 60; // 60 dias

function tokenDeSessao() {
  return crypto.createHash("sha256").update(process.env.PAINEL_SENHA).digest("hex");
}

function lerCookie(req, nome) {
  const cabecalho = req.headers.cookie || "";
  const encontrado = cabecalho.split(";").map((c) => c.trim()).find((c) => c.startsWith(nome + "="));
  return encontrado ? encontrado.slice(nome.length + 1) : null;
}

function autenticado(req) {
  const senha = process.env.PAINEL_SENHA;
  if (!senha) return true;
  if (lerCookie(req, NOME_COOKIE) === tokenDeSessao()) return true;
  const cabecalho = req.headers.authorization || "";
  if (!cabecalho.startsWith("Basic ")) return false;
  const [, senhaEnviada] = Buffer.from(cabecalho.slice(6), "base64").toString("utf8").split(":");
  return senhaEnviada === senha;
}

const html = fs.readFileSync(path.join(__dirname, "dashboard.html"));
const PASTA_ICONES = path.join(__dirname, "icons");

const servidor = http.createServer(async (req, res) => {
  if (!autenticado(req)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Painel da Carla"' });
    res.end("Senha necessária.");
    return;
  }

  // Renova o cookie de sessão a cada acesso autenticado (sliding expiration) — enquanto
  // usar o painel de tempos em tempos, nunca chega a expirar e pedir senha de novo.
  if (process.env.PAINEL_SENHA) {
    res.setHeader("Set-Cookie", `${NOME_COOKIE}=${tokenDeSessao()}; Max-Age=${SESSAO_SEGUNDOS}; Path=/; HttpOnly; SameSite=Lax`);
  }

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
    if (removido && removido.googleEventId) {
      await GoogleAgenda.cancelarEvento(removido.googleEventId);
    }
    if (removido && removido.appAgendamentoId) {
      await AppAgenda.cancelarAgendamento(removido.appAgendamentoId);
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
    res.end(JSON.stringify({ ok: !!removido }));
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
