"use strict";
// Sobe o painel de verdade (painel-server.js) numa COPIA do repositório, numa porta livre, com dados
// inventados. Serve à bateria de navegador (painel-repaginado.test.js) e a quem quiser ver a tela:
//
//   node tests/fixtures/painel-semeado.js cheio   (ou "vazio")
//
// Nada aqui toca o data/ de verdade: tudo vive numa pasta temporária, apagada ao parar. Nenhum
// WhatsApp, nenhuma credencial, nenhuma rede: sem as variáveis do .env as integrações ficam inertes.
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const RAIZ = path.join(__dirname, "..", "..");
const SENHA = "senha-de-teste";

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function copiarRepositorio(destino) {
  const ignorar = new Set(["node_modules", ".git", "data", "logs", "tests", "docs", ".github"]);
  fs.cpSync(RAIZ, destino, { recursive: true, filter: (origem) => !ignorar.has(path.basename(origem)) || origem === RAIZ });
  fs.symlinkSync(path.join(RAIZ, "node_modules"), path.join(destino, "node_modules"), "dir");
}

// Os dados do consultório fictício. Datas relativas a AGORA, pra a tela nunca "envelhecer".
const SEMEAR = `
"use strict";
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const Storage = require("./storage-node.js");
const Eventos = require("./registro-de-eventos.js");
const Crm = require("./crm.js");
const DIA = 86400e3;
const agora = Date.now();
const iso = (dias, horas = 0) => new Date(agora - dias * DIA - horas * 3600e3).toISOString();
const dataLocal = (dias) => { const d = new Date(agora - dias * DIA); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const arqCrm = path.join(__dirname, "data", "crm.json");

function contato(tel, nome, { dias = 0, horas = 1, msg = "", espera = false } = {}) {
  Storage.registrarContatoWhatsapp(tel, { pushName: nome });
  Storage.salvarSessao(tel, { ultimaAtividade: iso(dias, horas), ultimaMensagem: msg, aguardandoHumano: espera, historico: msg ? [{ role: "user", content: msg }] : [] });
}
function reserva(tel, responsavel, crianca, diasDeDiferenca, hora, tipo, pago, feitoHa) {
  const data = dataLocal(-diasDeDiferenca);
  const r = Storage.reservar({ slot: { id: "s-" + tel + data + hora, date: data, time: hora, label: data + " " + hora }, responsavel, crianca, telefone: tel, tipoConsulta: tipo });
  if (!r) throw new Error("reserva recusada " + tel);
  if (pago) Storage.alterarPagamento(r.slotId, true);
  if (feitoHa !== undefined) {
    const db = new DatabaseSync(path.join(__dirname, "data", "agendamentos.sqlite"));
    db.prepare("UPDATE agendamentos SET payload_json = json_set(payload_json, '$.registradoEm', ?, '$.pagoEm', ?) WHERE slot_id = ?").run(iso(feitoHa), pago ? iso(feitoHa) : null, r.slotId);
    db.close();
  }
  return r;
}
function funil(tel, ate, dias) {
  const passos = ["contato", "mensagem", "preco_informado", "horarios_oferecidos", "agendou", "pagou"];
  passos.slice(0, passos.indexOf(ate) + 1).forEach((tipo, i) => {
    const dados = tipo === "mensagem" ? { classe: "preco", trecho: "qual o valor?" } : tipo === "preco_informado" ? { valorCentavos: 45000 } : tipo === "pagou" ? { slotId: "x" + tel } : {};
    Eventos.registrar(tipo, tel, dados, new Date(agora - dias * DIA + i * 60000));
  });
}

if (process.argv[2] === "cheio") {
  const amanha = 1, hoje = 0;
  contato("+5519991110001", "Mariana Lopes", { horas: 3, msg: "Meu filho está com febre há 2 dias, posso falar com o doutor?", espera: true });
  funil("+5519991110001", "preco_informado", 2);

  contato("+5519991110002", "Carlos Teixeira", { horas: 5, msg: "Pode ser amanhã às 9h" });
  reserva("+5519991110002", "Carlos Teixeira", "Miguel", amanha, "09:00", "puericultura", false, 1);
  funil("+5519991110002", "agendou", 1);

  contato("+5519991110003", "Fernanda Alves", { dias: 2, msg: "Obrigada, doutor!" });
  reserva("+5519991110003", "Fernanda Alves", "Helena", -2, "10:00", "urgencia", true, 4);
  funil("+5519991110003", "pagou", 4);

  contato("+5519991110004", "Patrícia Moura", { dias: 20, msg: "Ok, obrigada" });
  reserva("+5519991110004", "Patrícia Moura", "Davi", -88, "14:00", "puericultura", true, 90);
  funil("+5519991110004", "pagou", 90);

  contato("+5519991110005", "Roberto Dias", { dias: 9, msg: "Vou ver com minha esposa e retorno" });
  funil("+5519991110005", "preco_informado", 9);

  contato("+5519991110006", "Juliana Prado", { dias: 40, msg: "Obrigada pelas informações" });
  funil("+5519991110006", "horarios_oferecidos", 40);

  contato("+5519991110007", "Tiago Mendes", { horas: 8, msg: "Chegamos mais cedo" });
  reserva("+5519991110007", "Tiago Mendes", "Lara", hoje, "16:00", "tnd", true, 3);
  funil("+5519991110007", "pagou", 3);

  contato("+5519991110008", "Camila Rocha", { dias: 1, msg: "Qual o valor da consulta?" });
  funil("+5519991110008", "preco_informado", 1);

  Crm.definirOrigem(arqCrm, "+5519991110001", "Instagram");
  Crm.definirOrigem(arqCrm, "+5519991110002", "Google");
  Crm.definirOrigem(arqCrm, "+5519991110007", "Indicação de paciente");
  Crm.definirOrigem(arqCrm, "+5519991110003", "Instagram");
  Crm.definirPerda(arqCrm, "+5519991110006", "preco");
}
`;

async function subir(modo = "vazio") {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "carla-painel-"));
  copiarRepositorio(tmp);
  const porta = await portaLivre();
  const arquivoServidor = path.join(tmp, "painel-server.js");
  const codigo = fs.readFileSync(arquivoServidor, "utf8");
  if (!/const PORTA = 3355;/.test(codigo)) throw new Error("a porta do painel mudou de lugar: ajuste o fixture");
  fs.writeFileSync(arquivoServidor, codigo.replace("const PORTA = 3355;", `const PORTA = ${porta};`));
  fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "semear.js"), SEMEAR);
  const semeio = spawnSync(process.execPath, ["semear.js", modo], { cwd: tmp, encoding: "utf8" });
  if (semeio.status !== 0) throw new Error("não consegui semear os dados:\n" + semeio.stderr);

  const env = { ...process.env, PAINEL_SENHA: SENHA };
  for (const chave of ["APP_SUPABASE_URL", "APP_CARLA_SECRET", "PORTAL_WEBHOOK_SECRET", "GOOGLE_CALENDAR_ID", "CARLA_SSO_SECRET"]) delete env[chave];
  const filho = spawn(process.execPath, ["painel-server.js"], { cwd: tmp, env, stdio: ["ignore", "pipe", "pipe"] });
  let saida = "";
  filho.stdout.on("data", (d) => { saida += d; });
  filho.stderr.on("data", (d) => { saida += d; });
  const url = `http://127.0.0.1:${porta}`;
  const limite = Date.now() + 20000;
  for (;;) {
    try { const r = await fetch(url + "/login"); if (r.status === 200) break; } catch { /* ainda subindo */ }
    if (filho.exitCode !== null) throw new Error("o painel não subiu:\n" + saida);
    if (Date.now() > limite) { filho.kill(); throw new Error("o painel demorou demais pra subir:\n" + saida); }
    await new Promise((r) => setTimeout(r, 150));
  }
  async function parar() {
    if (filho.exitCode === null) { filho.kill(); await new Promise((r) => filho.once("exit", r)); }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { url, porta, senha: SENHA, pasta: tmp, parar };
}

module.exports = { subir, SENHA };

if (require.main === module) {
  subir(process.argv[2] || "cheio").then((s) => {
    console.log(`Painel de teste em ${s.url} (senha: ${s.senha}). Ctrl+C para parar.`);
    process.on("SIGINT", async () => { await s.parar(); process.exit(0); });
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
