// Integração com o Sistema Pediátrico Integrado (prontuário): sempre que a Carla confirma um
// agendamento, envia uma cópia pra Edge Function protegida do SPI, pra já existir o registro
// sem precisar duplicar entrada manual depois. Também marca esse registro como cancelado lá
// se o agendamento for cancelado por aqui ou pelo painel. A Carla NÃO recebe chave
// administrativa do banco: ela conhece apenas o segredo estreito desta integração. Fail-open:
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

function segredoIntegracao() {
  // PORTAL_WEBHOOK_SECRET já autentica o SPI quando ele pede à Carla que avise a família.
  // Aceitá-lo aqui evita criar/copy-paste de mais uma chave para as mesmas duas pontas.
  return String(process.env.APP_CARLA_SECRET || process.env.PORTAL_WEBHOOK_SECRET || "").trim();
}

function configurado() {
  const ok = !!(process.env.APP_SUPABASE_URL && segredoIntegracao());
  if (!ok) {
    avisarUmaVez("rest",
      "Espelho no prontuário DESLIGADO: falta APP_SUPABASE_URL e/ou o segredo dedicado " +
      "APP_CARLA_SECRET (PORTAL_WEBHOOK_SECRET também é aceito).");
  }
  return ok;
}

// A única credencial que sai deste servidor para o SPI é o segredo dedicado. Nunca usa
// service_role, nem como fallback: fallback de uma chave estreita para a chave mestra
// desfaria justamente a proteção que esta ponte existe para dar.
function headersFuncao() {
  return {
    "Content-Type": "application/json",
    "X-Carla-Secret": segredoIntegracao(),
  };
}

function urlFuncao() {
  return `${String(process.env.APP_SUPABASE_URL || "").replace(/\/+$/, "")}` +
    "/functions/v1/carla-agendamento";
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
      acao: "marcar",
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
    const resultado = await requestJson(urlFuncao(), "POST", corpo, headersFuncao());
    return resultado?.agendamento_id || null;
  } catch (erro) {
    console.error("[APP AGENDA] Erro ao enviar agendamento pro Sistema Pediátrico Integrado:", erro.message);
    return null;
  }
}

// Marca o registro como cancelado lá (não apaga — mantém o histórico no prontuário).
async function cancelarAgendamento(appAgendamentoId) {
  if (!configurado() || !appAgendamentoId) return;
  try {
    const corpo = JSON.stringify({ acao: "cancelar", agendamento_id: appAgendamentoId });
    await requestJson(urlFuncao(), "POST", corpo, headersFuncao());
  } catch (erro) {
    console.error("[APP AGENDA] Erro ao cancelar agendamento no Sistema Pediátrico Integrado:", erro.message);
  }
}

// Manda pro prontuário o e-mail do responsável e a data de nascimento da criança, que a
// família responde DEPOIS da consulta já estar marcada.
//
// A ação `completar` faz mais que gravar colunas: do outro lado ela executa o trabalho
// que interessa — cria a ficha do paciente no prontuário (inferindo o sexo pelo primeiro
// nome) e monta o acesso do responsável ao portal, DESLIGADO, esperando o toque do Dr.
// Bruno. Nada disso acontece num INSERT de tabela.
//
// Assim como criar e cancelar, esta chamada usa apenas o segredo combinado. Se a VPS da
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
  if (!configurado()) return null;
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
    const resposta = await requestJson(urlFuncao(), "POST", corpo, headersFuncao());

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
