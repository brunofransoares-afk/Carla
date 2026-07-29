// Integração com o Sistema Pediátrico Integrado (prontuário): sempre que a Carla confirma um
// agendamento, envia uma cópia pra lá também, via HTTP (API REST do Supabase), pra já existir
// o registro do paciente sem precisar duplicar entrada manual depois. Também marca esse
// registro como cancelado lá se o agendamento for cancelado por aqui ou pelo painel. Fail-open:
// se qualquer chamada falhar (serviço fora do ar, timeout, chave errada), só loga o erro e
// segue — o agendamento aqui e no Google Agenda já foram feitos/desfeitos antes disso
// acontecer, uma falha nesta integração nunca desfaz nem atrasa o resto.

const https = require("https");

const TIMEOUT_MS = 8000;

// Avisa UMA vez por processo que uma integração está desligada por falta de variável.
// Existe porque o `if (!configurado()) return` é silencioso: quando as variáveis faltam
// no servidor, a cópia pro prontuário simplesmente para de sair e NÃO aparece nada em
// log nenhum — o que já custou horas de caça. Uma linha no `pm2 logs` resolve isso.
const jaAvisou = new Set();
function avisarUmaVez(chave, mensagem) {
  if (jaAvisou.has(chave)) return;
  jaAvisou.add(chave);
  console.warn(`[APP AGENDA] ${mensagem}`);
}

function configurado() {
  const ok = !!(process.env.APP_SUPABASE_URL && process.env.APP_OWNER_ID && process.env.APP_SERVICE_ROLE_KEY);
  if (!ok) {
    avisarUmaVez("rest",
      "Espelho no prontuário DESLIGADO: faltam APP_SUPABASE_URL, APP_OWNER_ID ou APP_SERVICE_ROLE_KEY.");
  }
  return ok;
}

// A ação `completar` do prontuário NÃO usa a service role: é uma Edge Function que
// autentica pelo segredo combinado. Por isso a configuração dela é outra.
function configuradoFuncao() {
  const ok = !!(process.env.APP_SUPABASE_URL && process.env.APP_CARLA_SECRET);
  if (!ok) {
    avisarUmaVez("funcao",
      "Envio de e-mail/nascimento pro prontuário DESLIGADO: faltam APP_SUPABASE_URL ou APP_CARLA_SECRET.");
  }
  return ok;
}

// Cabeçalhos da API REST (PostgREST): autenticam com a service role, que passa por cima
// de toda a RLS do banco do prontuário.
function headersRest() {
  const chave = process.env.APP_SERVICE_ROLE_KEY;
  return {
    apikey: chave,
    Authorization: `Bearer ${chave}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

// Cabeçalhos da Edge Function: só o segredo combinado, nenhuma chave de banco.
function headersFuncao() {
  return {
    "X-Carla-Secret": process.env.APP_CARLA_SECRET,
    "Content-Type": "application/json",
  };
}

// Faz a requisição e devolve o corpo já parseado como JSON (ou null se a resposta vier vazia).
function requestJson(url, method, corpo, headers) {
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
    const resultado = await requestJson(
      `${process.env.APP_SUPABASE_URL}/rest/v1/agendamentos`, "POST", corpo, headersRest());
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
    await requestJson(url, "PATCH", corpo, headersRest());
  } catch (erro) {
    console.error("[APP AGENDA] Erro ao cancelar agendamento no Sistema Pediátrico Integrado:", erro.message);
  }
}

// Manda pro prontuário o e-mail do responsável e a data de nascimento da criança, que a
// família responde DEPOIS da consulta já estar marcada.
//
// Por que aqui é Edge Function e não a API REST como o resto deste arquivo: escrever
// direto na tabela só grava as colunas. Do outro lado, a ação `completar` faz o trabalho
// que interessa — cria a ficha do paciente no prontuário (inferindo o sexo pelo primeiro
// nome) e monta o acesso do responsável ao portal, DESLIGADO, esperando o toque do Dr.
// Bruno. Nada disso acontece num INSERT de tabela.
//
// De brinde, esta chamada não usa a service role: só o segredo combinado. Se a VPS da
// Carla for comprometida, um segredo que só marca consulta é muito menos grave que uma
// chave que lê e escreve o prontuário inteiro de qualquer paciente.
//
// Fail-open igual ao resto do arquivo: os dados já estão guardados aqui (JSON + CSV) e já
// foram pro WhatsApp do Dr. Bruno antes desta chamada. Falhar aqui não perde nada nem
// atrasa a resposta pra família.
//
// dados: { appAgendamentoId, dataNascimento, email } — os dois últimos são opcionais,
// mas pelo menos um precisa vir (a família pode responder um por vez).
async function completarDadosDoPaciente(dados) {
  if (!configuradoFuncao()) return null;
  if (!dados || !dados.appAgendamentoId) {
    // Sem o id do registro de lá não há o que completar. Acontece se o espelho do
    // agendamento falhou antes (ou está desligado); os dados continuam no CSV.
    console.warn("[APP AGENDA] Não mandei e-mail/nascimento pro prontuário: agendamento sem appAgendamentoId.");
    return null;
  }
  if (!dados.dataNascimento && !dados.email) return null;

  try {
    const corpo = JSON.stringify({
      acao: "completar",
      agendamento_id: dados.appAgendamentoId,
      data_nascimento: dados.dataNascimento || undefined,
      responsavel_email: dados.email || undefined,
    });
    const resposta = await requestJson(
      `${process.env.APP_SUPABASE_URL}/functions/v1/carla-agendamento`, "POST", corpo, headersFuncao());

    // A função responde 200 mesmo quando não deu pra criar a ficha (nome ambíguo, SQL
    // pendente). Logar o motivo é o que evita achar que funcionou quando não funcionou.
    if (resposta && resposta.portal && resposta.portal !== "criado_aguardando_ok" && resposta.portal !== "ja_liberado") {
      console.warn(`[APP AGENDA] Prontuário recebeu os dados mas o portal não saiu: ${resposta.portal}` +
        (resposta.sem_ficha_porque ? ` (${resposta.sem_ficha_porque})` : ""));
    }
    return resposta;
  } catch (erro) {
    console.error("[APP AGENDA] Erro ao mandar e-mail/nascimento pro Sistema Pediátrico Integrado:", erro.message);
    return null;
  }
}

module.exports = { enviarAgendamento, cancelarAgendamento, completarDadosDoPaciente };
