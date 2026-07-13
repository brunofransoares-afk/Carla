// Integração com o Sistema Pediátrico Integrado (prontuário): sempre que a Carla confirma um
// agendamento, envia uma cópia pra lá também, via HTTP (API REST do Supabase), pra já existir
// o registro do paciente sem precisar duplicar entrada manual depois. Também marca esse
// registro como cancelado lá se o agendamento for cancelado por aqui ou pelo painel. Fail-open:
// se qualquer chamada falhar (serviço fora do ar, timeout, chave errada), só loga o erro e
// segue — o agendamento aqui e no Google Agenda já foram feitos/desfeitos antes disso
// acontecer, uma falha nesta integração nunca desfaz nem atrasa o resto.

const https = require("https");

const TIMEOUT_MS = 8000;

function configurado() {
  return !!(process.env.APP_SUPABASE_URL && process.env.APP_OWNER_ID && process.env.APP_SERVICE_ROLE_KEY);
}

// Faz a requisição e devolve o corpo já parseado como JSON (ou null se a resposta vier vazia).
function requestJson(url, method, corpo) {
  const chave = process.env.APP_SERVICE_ROLE_KEY;
  const headers = {
    apikey: chave,
    Authorization: `Bearer ${chave}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  if (typeof fetch === "function") {
    const controlador = new AbortController();
    const timeout = setTimeout(() => controlador.abort(), TIMEOUT_MS);
    return fetch(url, { method, headers, body: corpo, signal: controlador.signal })
      .finally(() => clearTimeout(timeout))
      .then(async (resposta) => {
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        const texto = await resposta.text();
        return texto ? JSON.parse(texto) : null;
      });
  }

  // Node < 18, sem fetch global — usa https nativo.
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: { ...headers, "Content-Length": Buffer.byteLength(corpo) },
      timeout: TIMEOUT_MS,
    }, (res) => {
      let corpoResposta = "";
      res.on("data", (chunk) => { corpoResposta += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(corpoResposta ? JSON.parse(corpoResposta) : null);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Timeout")));
    req.on("error", reject);
    req.write(corpo);
    req.end();
  });
}

// dados: { pacienteNome, responsavelNome, dataNascimento, telefone, inicio (Date), fim (Date), observacoes }
// Devolve o id do registro criado lá (pra poder cancelar depois), ou null se não deu certo.
async function enviarAgendamento(dados) {
  if (!configurado()) return null;
  try {
    const corpo = JSON.stringify({
      owner_id: process.env.APP_OWNER_ID,
      paciente_nome: dados.pacienteNome,
      responsavel_nome: dados.responsavelNome || null,
      data_nascimento: dados.dataNascimento || null,
      telefone: dados.telefone || null,
      inicio: dados.inicio.toISOString(),
      fim: dados.fim ? dados.fim.toISOString() : null,
      observacoes: dados.observacoes || null,
      origem: "carla",
      status: "agendado",
    });
    const resultado = await requestJson(`${process.env.APP_SUPABASE_URL}/rest/v1/agendamentos`, "POST", corpo);
    return resultado?.[0]?.id || null;
  } catch (erro) {
    console.error("[APP AGENDA] Erro ao enviar agendamento pro Sistema Pediátrico Integrado:", erro.message);
    return null;
  }
}

// Marca o registro como cancelado lá (não apaga — mantém o histórico no prontuário).
async function cancelarAgendamento(appAgendamentoId) {
  if (!configurado() || !appAgendamentoId) return;
  try {
    const corpo = JSON.stringify({ status: "cancelado" });
    const url = `${process.env.APP_SUPABASE_URL}/rest/v1/agendamentos?id=eq.${encodeURIComponent(appAgendamentoId)}`;
    await requestJson(url, "PATCH", corpo);
  } catch (erro) {
    console.error("[APP AGENDA] Erro ao cancelar agendamento no Sistema Pediátrico Integrado:", erro.message);
  }
}

module.exports = { enviarAgendamento, cancelarAgendamento };
