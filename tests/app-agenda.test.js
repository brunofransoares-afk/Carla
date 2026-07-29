/*
 * Bateria do app-agenda.js — a ponte com o Sistema Pediátrico Integrado.
 *
 * Este repositório não tinha teste, e esta é a integração onde não ter dói mais: ela
 * roda em background (não é aguardada), falha em silêncio de propósito (fail-open) e
 * ninguém percebe se parar. Foi exatamente assim que a cópia pro prontuário ficou meses
 * sem funcionar sem ninguém notar.
 *
 * Aqui o `fetch` global é substituído, então nada sai pra rede: o teste inspeciona o que
 * a função IA mandar. Roda com:  node tests/app-agenda.test.js
 */
"use strict";
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

// ------------------------------------------------------------------ arnês
const chamadas = [];
let respostaFalsa = { ok: true, portal: "criado_aguardando_ok" };
let erroDeRede = null;

global.fetch = function (url, opcoes) {
  chamadas.push({ url: url, method: opcoes.method, headers: opcoes.headers, body: opcoes.body });
  if (erroDeRede) return Promise.reject(new Error(erroDeRede));
  return Promise.resolve({
    ok: true,
    text: () => Promise.resolve(JSON.stringify(respostaFalsa)),
  });
};

const avisos = [];
const errosLog = [];
console.warn = (...a) => avisos.push(a.join(" "));
console.error = (...a) => errosLog.push(a.join(" "));

const AppAgenda = require(path.join(__dirname, "..", "app-agenda.js"));

function limpar() {
  chamadas.length = 0; avisos.length = 0; errosLog.length = 0;
  erroDeRede = null;
  respostaFalsa = { ok: true, portal: "criado_aguardando_ok" };
}
function configurar() {
  process.env.APP_SUPABASE_URL = "https://exemplo.supabase.co";
  process.env.APP_CARLA_SECRET = "segredo-combinado";
  process.env.APP_OWNER_ID = "medico-uuid";
  process.env.APP_SERVICE_ROLE_KEY = "service-role";
}

(async function () {
  // -------------------------------------------------- 1. caminho feliz
  configurar(); limpar();
  let r = await AppAgenda.completarDadosDoPaciente({
    appAgendamentoId: "ag-123", email: "ana@exemplo.com", dataNascimento: "2022-03-10",
  });
  eq(chamadas.length, 1, "1: fez uma chamada");
  const c = chamadas[0];
  ok(/\/functions\/v1\/carla-agendamento$/.test(c.url), "1: bate na Edge Function, não no PostgREST — " + c.url);
  ok(!/\/rest\/v1\//.test(c.url), "1: NÃO usa a API REST de tabela");
  eq(c.method, "POST", "1: método POST");
  eq(c.headers["X-Carla-Secret"], "segredo-combinado", "1: manda o segredo combinado");
  ok(!c.headers.apikey && !c.headers.Authorization,
    "1: NÃO manda a service role (é a chave que lê o prontuário inteiro)");
  const corpo = JSON.parse(c.body);
  eq(corpo.acao, "completar", "1: acao completar");
  eq(corpo.agendamento_id, "ag-123", "1: id do agendamento do outro lado");
  eq(corpo.data_nascimento, "2022-03-10", "1: nascimento em AAAA-MM-DD");
  eq(corpo.responsavel_email, "ana@exemplo.com", "1: e-mail");
  eq(r.portal, "criado_aguardando_ok", "1: devolve a resposta da função");
  eq(avisos.length, 0, "1: caminho normal não avisa nada");

  // ------------------------------------- 2. só um dos dois campos
  limpar();
  await AppAgenda.completarDadosDoPaciente({ appAgendamentoId: "ag-1", email: "ana@exemplo.com" });
  let b = JSON.parse(chamadas[0].body);
  ok(!("data_nascimento" in b), "2: sem nascimento, o campo nem vai (não manda null)");
  eq(b.responsavel_email, "ana@exemplo.com", "2: e-mail vai sozinho");
  limpar();
  await AppAgenda.completarDadosDoPaciente({ appAgendamentoId: "ag-1", dataNascimento: "2022-03-10" });
  b = JSON.parse(chamadas[0].body);
  ok(!("responsavel_email" in b), "2: sem e-mail, o campo nem vai");
  eq(b.data_nascimento, "2022-03-10", "2: nascimento vai sozinho");

  // ------------------------------------- 3. nada pra mandar = nem tenta
  limpar();
  r = await AppAgenda.completarDadosDoPaciente({ appAgendamentoId: "ag-1" });
  eq(chamadas.length, 0, "3: sem nenhum dado não chama a rede");
  eq(r, null, "3: devolve null");

  // ------------------------------------- 4. sem appAgendamentoId: avisa
  limpar();
  r = await AppAgenda.completarDadosDoPaciente({ email: "ana@exemplo.com" });
  eq(chamadas.length, 0, "4: sem id não chama");
  eq(r, null, "4: devolve null");
  ok(avisos.some((a) => /appAgendamentoId/.test(a)),
    "4: AVISA no log — sem isso o dado desaparece calado");

  // --------------------------- 5. variável faltando: avisa UMA vez
  limpar();
  delete process.env.APP_CARLA_SECRET;
  await AppAgenda.completarDadosDoPaciente({ appAgendamentoId: "ag-1", email: "ana@exemplo.com" });
  await AppAgenda.completarDadosDoPaciente({ appAgendamentoId: "ag-2", email: "b@exemplo.com" });
  await AppAgenda.completarDadosDoPaciente({ appAgendamentoId: "ag-3", email: "c@exemplo.com" });
  eq(chamadas.length, 0, "5: sem segredo não chama");
  eq(avisos.filter((a) => /APP_CARLA_SECRET/.test(a)).length, 1,
    "5: avisa UMA vez, não uma por mensagem (senão entope o log)");
  configurar();

  // ------------------------ 6. função respondeu, mas o portal não saiu
  limpar();
  respostaFalsa = { ok: true, portal: "sem_coluna_sql_pendente", aviso: "rode o SQL" };
  await AppAgenda.completarDadosDoPaciente({ appAgendamentoId: "ag-1", email: "ana@exemplo.com" });
  ok(avisos.some((a) => /portal não saiu|sem_coluna_sql_pendente/.test(a)),
    "6: 200 com portal pendente também avisa (senão parece que funcionou)");

  limpar();
  respostaFalsa = { ok: true, portal: "sem_ficha", sem_ficha_porque: "“alex” é usado para os dois sexos no Brasil." };
  await AppAgenda.completarDadosDoPaciente({ appAgendamentoId: "ag-1", email: "ana@exemplo.com" });
  ok(avisos.some((a) => /dois sexos/.test(a)), "6: repassa o motivo de não ter criado a ficha");

  limpar();
  respostaFalsa = { ok: true, portal: "ja_liberado" };
  await AppAgenda.completarDadosDoPaciente({ appAgendamentoId: "ag-1", email: "ana@exemplo.com" });
  eq(avisos.length, 0, "6: reenvio de algo já liberado não é problema, não avisa");

  // ------------------------------------- 7. fail-open de verdade
  limpar();
  erroDeRede = "getaddrinfo ENOTFOUND";
  r = await AppAgenda.completarDadosDoPaciente({ appAgendamentoId: "ag-1", email: "ana@exemplo.com" });
  eq(r, null, "7: erro de rede devolve null em vez de estourar");
  ok(errosLog.some((e) => /ENOTFOUND/.test(e)), "7: e loga o erro");

  // ------------------- 8. o espelho do agendamento não regrediu
  limpar();
  await AppAgenda.enviarAgendamento({
    pacienteNome: "Miguel", responsavelNome: "Ana", telefone: "+5531900000000",
    inicio: new Date("2026-08-10T17:30:00Z"), fim: null,
  });
  const ca = chamadas[0];
  ok(/\/rest\/v1\/agendamentos$/.test(ca.url), "8: enviarAgendamento continua na API REST");
  eq(ca.headers.apikey, "service-role", "8: e continua usando a service role");
  eq(JSON.parse(ca.body).origem, "carla", "8: origem carla preservada");

  // ------------------------------------------------------------- fim
  console.log("app-agenda: " + passou + " passaram, " + falhou + " falharam");
  if (falhou) {
    erros.slice(0, 30).forEach((e) => console.log("  FALHOU: " + e));
    process.exit(1);
  }
})().catch((e) => {
  console.log("app-agenda: ERRO NÃO TRATADO — " + (e && e.stack || e));
  process.exit(1);
});
