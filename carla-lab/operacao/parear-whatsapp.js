// Refaz o pareamento do WhatsApp da Carla.
//
// Escrito em 29/07/2026, durante uma queda: a sessão do Baileys foi invalidada e o
// server.js ficou num laço de reconexão sem nunca receber "loggedOut", que é a única
// condição em que ele para de tentar.
//
// Usa CÓDIGO DE PAREAMENTO, não QR code. O motivo é prático: quem administra o servidor
// costuma estar no SSH pelo celular, e não dá para escanear um QR exibido na tela do
// mesmo aparelho que tem a câmera. Com o código, é só digitar oito caracteres no
// WhatsApp. Se preferir QR, passe --qr.
//
// NÃO faz parte do bot. É uma ferramenta de operação, rodada à mão, e some da memória
// assim que termina. Não altera nenhum arquivo do sistema além da pasta de sessão.
//
//   node parear-whatsapp.js 5519996859061
//   node parear-whatsapp.js --qr
//
// ANTES de rodar:
//   pm2 stop carla-bot
//   mv .../data/auth .../data/auth.antes-de-parear-AAAA-MM-DD
//
// Duas instâncias na mesma sessão derrubam uma à outra, e mover em vez de apagar deixa
// caminho de volta.

const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");

const REPO = process.env.CARLA_REPO || path.join("/root", "carla", "carla-whatsapp-bot");
const DIR_AUTH = process.env.CARLA_AUTH_DIR || path.join(REPO, "data", "auth");

const argumentos = process.argv.slice(2);
const usarQr = argumentos.includes("--qr");
const numero = (argumentos.find((a) => /^\d{10,15}$/.test(a)) || "").trim();

if (!usarQr && !numero) {
  console.log("\nInforme o número do WhatsApp, só dígitos, com país e DDD:");
  console.log("  node parear-whatsapp.js 5519996859061");
  console.log("\nOu use QR code (precisa de outra tela para escanear):");
  console.log("  node parear-whatsapp.js --qr\n");
  process.exit(1);
}

// As bibliotecas vivem no node_modules do repositório, e este script roda de fora dele.
// Resolver a partir do package.json do repositório faz funcionar de qualquer pasta.
if (!fs.existsSync(path.join(REPO, "package.json"))) {
  console.log(`\nNão achei o repositório em ${REPO}.`);
  console.log("Informe o caminho:  CARLA_REPO=/caminho/do/repo node parear-whatsapp.js ...\n");
  process.exit(1);
}
const requireDoRepo = createRequire(path.join(REPO, "package.json"));
const QRCode = requireDoRepo("qrcode");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} = requireDoRepo("@whiskeysockets/baileys");

// O logger do Baileys despeja JSON a cada evento e enterraria o código de pareamento no
// meio do ruído. Este silencia tudo; os erros que importam são tratados abaixo.
const silencioso = {
  level: "silent",
  child: () => silencioso,
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let codigoJaPedido = false;

async function parear() {
  const { state, saveCreds } = await useMultiFileAuthState(DIR_AUTH);
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,   // pareamento não precisa puxar histórico; o bot puxa depois
    logger: silencioso,
    // Identificação de navegador PADRÃO, não inventada. O pareamento por código só é
    // aceito com uma das identificações que o WhatsApp conhece; um nome próprio faz o
    // código ser gerado e depois recusado na hora de digitar, que foi o que aconteceu
    // em 29/07/2026 com browser: ["Carla", "Chrome", "1.0.0"].
    browser: Browsers.ubuntu("Chrome"),
  });

  sock.ev.on("creds.update", saveCreds);

  // Código de pareamento: só pode ser pedido uma vez, e só se ainda não estiver registrado.
  if (!usarQr && !sock.authState.creds.registered && !codigoJaPedido) {
    codigoJaPedido = true;
    // Espera o socket ficar realmente pronto. Pedir cedo demais gera um código que o
    // servidor não honra depois.
    await esperar(6000);
    try {
      const codigo = await sock.requestPairingCode(numero);
      const formatado = codigo.match(/.{1,4}/g).join("-");
      console.log("\n" + "=".repeat(46));
      console.log("  CÓDIGO DE PAREAMENTO:   " + formatado);
      console.log("=".repeat(46));
      console.log("\n  No celular:");
      console.log("  WhatsApp > Configurações > Aparelhos conectados");
      console.log("  > Conectar dispositivo > Conectar com número de telefone");
      console.log("  > digite o código acima\n");
      console.log("  O código expira em poucos minutos.\n");
    } catch (erro) {
      console.log("\nNão consegui gerar o código:", erro.message);
      console.log("Confira se o número está certo (só dígitos, com país e DDD).\n");
      process.exit(1);
    }
  }

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr && usarQr) {
      console.log(await QRCode.toString(qr, { type: "terminal", small: true }));
      console.log("Escaneie com o WhatsApp do celular. O código troca a cada ~20 segundos.\n");
    }

    if (connection === "open") {
      console.log("\n" + "=".repeat(46));
      console.log("  PAREADO. A Carla está conectada.");
      console.log("=".repeat(46));
      console.log("\n  Agora suba o bot:");
      console.log("    pm2 start carla-bot");
      console.log("    pm2 logs carla-bot --lines 20\n");
      console.log("  Espere a linha: Carla está conectada e respondendo no WhatsApp!\n");
      await esperar(2000); // dá tempo de gravar as credenciais
      process.exit(0);
    }

    if (connection === "close") {
      const codigo = lastDisconnect?.error?.output?.statusCode;

      // 515 depois de parear é esperado: o WhatsApp pede uma reconexão para valer.
      if (codigo === DisconnectReason.restartRequired) {
        console.log("Reconectando para concluir o pareamento...");
        return parear();
      }

      const nome = Object.keys(DisconnectReason).find((k) => DisconnectReason[k] === codigo);
      console.log(`\nConexão fechada. Código: ${codigo}${nome ? ` (${nome})` : ""}`);
      if (codigo === DisconnectReason.loggedOut) {
        console.log("A sessão foi encerrada. Rode de novo para parear.\n");
      }
      process.exit(1);
    }
  });
}

console.log(`\nPasta de sessão: ${DIR_AUTH}`);

// Pareamento SEMPRE começa do zero. Credencial pela metade, sobrada de uma tentativa
// anterior, faz o WhatsApp fechar a conexão antes mesmo de gerar o código, com a
// mensagem inútil "Connection Closed". Avisar não bastava: quem está com o consultório
// fora do ar não deveria precisar limpar isso à mão.
if (fs.existsSync(DIR_AUTH) && fs.readdirSync(DIR_AUTH).length > 0) {
  const guardada = `${DIR_AUTH}.anterior-${Date.now()}`;
  fs.renameSync(DIR_AUTH, guardada);
  console.log(`Sessão anterior movida para: ${path.basename(guardada)}`);
}
parear().catch((erro) => {
  console.error("\nErro:", erro.message, "\n");
  process.exit(1);
});
