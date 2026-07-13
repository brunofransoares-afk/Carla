// Integração com o Sistema Pediátrico Integrado (prontuário): sempre que a Carla confirma um
// agendamento, envia uma cópia pra lá também, via HTTP (API REST do Supabase), pra já existir
// o registro do paciente sem precisar duplicar entrada manual depois. Fail-open: se essa
// chamada falhar por qualquer motivo (serviço fora do ar, timeout, chave errada), só loga o
// erro e segue — o agendamento aqui e no Google Agenda já foram feitos antes dessa chamada
// acontecer, uma falha aqui nunca desfaz nem atrasa isso.

const https = require("https");

const TIMEOUT_MS = 8000;

function configurado() {
  return !!(process.env.APP_SUPABASE_URL && process.env.APP_OWNER_ID && process.env.APP_SERVICE_ROLE_KEY);
}

function postJson(url, corpo) {
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
    return fetch(url, { method: "POST", headers, body: corpo, signal: controlador.signal })
      .finally(() => clearTimeout(timeout))
      .then((resposta) => {
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      });
  }

  // Node < 18, sem fetch global — usa https nativo.
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: { ...headers, "Content-Length": Buffer.byteLength(corpo) },
      timeout: TIMEOUT_MS,
    }, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        res.resume();
        resolve();
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });
    req.on("timeout", () => req.destroy(new Error("Timeout")));
    req.on("error", reject);
    req.write(corpo);
    req.end();
  });
}

// dados: { pacienteNome, responsavelNome, dataNascimento, telefone, inicio (Date), fim (Date), observacoes }
async function enviarAgendamento(dados) {
  if (!configurado()) return;
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
    await postJson(`${process.env.APP_SUPABASE_URL}/rest/v1/agendamentos`, corpo);
  } catch (erro) {
    console.error("[APP AGENDA] Erro ao enviar agendamento pro Sistema Pediátrico Integrado:", erro.message);
  }
}

module.exports = { enviarAgendamento };
