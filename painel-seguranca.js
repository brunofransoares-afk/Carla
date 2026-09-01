"use strict";

const crypto = require("crypto");

const LIMITE_CORPO_PADRAO = 64 * 1024;

function inteiroPositivo(valor, padrao, maximo) {
  const n = Number.parseInt(String(valor || ""), 10);
  if (!Number.isFinite(n) || n <= 0) return padrao;
  return Math.min(n, maximo);
}

// Números vindos da lista de contatos já chegam no formato internacional do WhatsApp.
// O sinal de "+" é informação: removê-lo antes de decidir o DDI transformava, por exemplo,
// +1 619... em +55 16... porque ambos têm 11 dígitos sem formatação. Sem "+" (digitação
// manual), números nacionais de até 11 dígitos continuam assumindo Brasil.
function normalizarTelefoneManual(bruto) {
  const texto = String(bruto || "").trim();
  if (!texto) return null;

  const prefixoMais = texto.startsWith("+");
  const prefixoZeroZero = texto.startsWith("00");
  let digitos = texto.replace(/\D/g, "");
  if (prefixoZeroZero) digitos = digitos.slice(2);
  if (!prefixoMais && !prefixoZeroZero && digitos.length <= 11) digitos = "55" + digitos;

  // E.164 admite no máximo 15 dígitos e código de país nunca começa por zero.
  if (digitos.length < 8 || digitos.length > 15 || digitos.startsWith("0")) return null;
  return "+" + digitos;
}

// Os hashes deixam os dois buffers com o mesmo tamanho. Assim até uma senha com tamanho
// diferente passa pela comparação de tempo constante, sem lançar nem revelar onde divergiu.
function compararSegredo(recebido, esperado) {
  const a = crypto.createHash("sha256").update(String(recebido || "")).digest();
  const b = crypto.createHash("sha256").update(String(esperado || "")).digest();
  return crypto.timingSafeEqual(a, b);
}

function lerCookie(req, nome) {
  const cabecalho = String(req?.headers?.cookie || "");
  const prefixo = nome + "=";
  const encontrado = cabecalho.split(";").map((c) => c.trim())
    .find((c) => c.startsWith(prefixo));
  if (!encontrado) return null;
  try { return decodeURIComponent(encontrado.slice(prefixo.length)); } catch { return null; }
}

function credencialBasic(req) {
  const cabecalho = String(req?.headers?.authorization || "");
  if (!cabecalho.startsWith("Basic ")) return null;
  try {
    const texto = Buffer.from(cabecalho.slice(6), "base64").toString("utf8");
    const separador = texto.indexOf(":");
    return separador >= 0 ? texto.slice(separador + 1) : null;
  } catch {
    return null;
  }
}

function criarSessoes({ nomeCookie, ttlMs, agora = () => Date.now(), maximo = 500 } = {}) {
  const sessoes = new Map();
  const ttl = inteiroPositivo(ttlMs, 7 * 24 * 60 * 60 * 1000, 60 * 24 * 60 * 60 * 1000);

  function limpar() {
    const instante = agora();
    for (const [token, validade] of sessoes) {
      if (validade <= instante) sessoes.delete(token);
    }
    while (sessoes.size > maximo) sessoes.delete(sessoes.keys().next().value);
  }

  function entrar(recebida, senha) {
    limpar();
    if (!compararSegredo(recebida, senha)) return { ok: false };

    const token = crypto.randomBytes(32).toString("base64url");
    sessoes.set(token, agora() + ttl);
    limpar();
    return { ok: true, token, nova: true };
  }

  function autenticar(req, senha, { permitirBasic = true } = {}) {
    limpar();
    const existente = lerCookie(req, nomeCookie);
    if (existente && sessoes.has(existente) && sessoes.get(existente) > agora()) {
      sessoes.set(existente, agora() + ttl);
      return { ok: true, token: existente, nova: false };
    }

    if (!permitirBasic) return { ok: false };
    const enviada = credencialBasic(req);
    if (enviada == null) return { ok: false };
    return entrar(enviada, senha);
  }

  return { autenticar, entrar, tamanho: () => sessoes.size };
}

function cookieSeguro(nome, token, ttlSegundos) {
  return `${nome}=${encodeURIComponent(token)}; Max-Age=${ttlSegundos}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

function identificarCliente(req) {
  // O painel só escuta em 127.0.0.1 e recebe internet pelo nginx. X-Real-IP é preferido; se
  // houver uma cadeia X-Forwarded-For, o nginx acrescenta o cliente real no final. Usar o
  // primeiro permitiria ao atacante inventar um IP novo em cada tentativa de senha.
  const real = String(req?.headers?.["x-real-ip"] || "").trim();
  const cadeia = String(req?.headers?.["x-forwarded-for"] || "").split(",")
    .map((item) => item.trim()).filter(Boolean);
  const encaminhado = cadeia.length ? cadeia[cadeia.length - 1] : "";
  return (real || encaminhado || String(req?.socket?.remoteAddress || "desconhecido")).slice(0, 80);
}

// Defesa de CSRF para os botões que mudam estado. SameSite=Strict protege a sessão e estes
// cabeçalhos também recusam explicitamente pedidos vindos de outra página.
function origemPermitida(req) {
  const site = String(req?.headers?.["sec-fetch-site"] || "").toLowerCase();
  if (site === "cross-site") return false;
  const origem = String(req?.headers?.origin || "").trim();
  if (!origem) return true;
  try {
    const host = String(req?.headers?.host || "").trim().toLowerCase();
    return !!host && new URL(origem).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

// Safari 26 (iPhone e macOS) envia `Origin: null` no POST de um formulário normal aberto
// neste painel. Isso não pode ser tratado como outro site: o navegador marca pedidos realmente
// externos como Sec-Fetch-Site: cross-site, que continua recusado. A exceção fica restrita ao
// login; as APIs autenticadas permanecem usando a validação rigorosa acima.
function origemLoginPermitida(req) {
  const site = String(req?.headers?.["sec-fetch-site"] || "").toLowerCase();
  if (site === "cross-site") return false;
  const origem = String(req?.headers?.origin || "").trim().toLowerCase();
  if (origem === "null") return true;
  return origemPermitida(req);
}

function criarLimitador({ maximo, janelaMs, agora = () => Date.now() }) {
  const entradas = new Map();
  return {
    verificar(chave) {
      const instante = agora();
      let item = entradas.get(chave);
      if (!item || item.ate <= instante) item = { quantidade: 0, ate: instante + janelaMs };
      item.quantidade++;
      entradas.set(chave, item);
      if (entradas.size > 2000) {
        for (const [k, v] of entradas) if (v.ate <= instante) entradas.delete(k);
      }
      return {
        permitido: item.quantidade <= maximo,
        restante: Math.max(0, maximo - item.quantidade),
        tentarEm: Math.max(1, Math.ceil((item.ate - instante) / 1000)),
      };
    },
    limpar(chave) { entradas.delete(chave); },
  };
}

function erroHttp(statusCode, mensagem) {
  const erro = new Error(mensagem);
  erro.statusCode = statusCode;
  return erro;
}

function lerCorpo(req, { limite = LIMITE_CORPO_PADRAO, json = false } = {}) {
  return new Promise((resolve, reject) => {
    const declarado = Number(req.headers["content-length"] || 0);
    if (declarado > limite) {
      req.resume();
      reject(erroHttp(413, "Corpo da requisição acima do limite."));
      return;
    }

    let bytes = 0;
    const partes = [];
    let encerrado = false;
    req.on("data", (parte) => {
      if (encerrado) return;
      bytes += parte.length;
      if (bytes > limite) {
        encerrado = true;
        partes.length = 0;
        reject(erroHttp(413, "Corpo da requisição acima do limite."));
        return;
      }
      partes.push(parte);
    });
    req.on("end", () => {
      if (encerrado) return;
      const texto = Buffer.concat(partes).toString("utf8");
      if (!json) return resolve(texto);
      try { resolve(JSON.parse(texto || "{}")); }
      catch { reject(erroHttp(400, "JSON inválido.")); }
    });
    req.on("error", reject);
  });
}

module.exports = {
  LIMITE_CORPO_PADRAO,
  compararSegredo,
  cookieSeguro,
  criarLimitador,
  criarSessoes,
  identificarCliente,
  normalizarTelefoneManual,
  origemLoginPermitida,
  origemPermitida,
  inteiroPositivo,
  lerCorpo,
};
