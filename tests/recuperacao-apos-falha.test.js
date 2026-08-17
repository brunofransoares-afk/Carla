/*
 * Uma ferramenta pode reservar/cancelar antes de a IA redigir a mensagem final. Se a chamada
 * final cair, essas ações precisam continuar no resultado e na conversa.
 *
 * Roda com: node tests/recuperacao-apos-falha.test.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { recuperarAposFalha } = require("../recuperacao-apos-falha.js");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }

function contexto(extra = {}) {
  return {
    acoesRealizadas: [], cancelamentosRealizados: [], escalar: null,
    escalarTipo: null, escalarPergunta: null, escalarData: null, escalarHora: null,
    dadosDoPacienteRegistrados: null, horariosOferecidos: new Set(["slot-1"]),
    ...extra,
  };
}

// Sem efeito, mantém o comportamento antigo: pede repetição e não inventa histórico.
{
  const r = recuperarAposFalha({ historico: [], texto: "oi", ctx: contexto() });
  ok(/pode repetir/i.test(r.resposta), "sem efeito pede para repetir");
  ok(r.historico.length === 0, "sem efeito não finge que a resposta entrou no histórico");
}

// Reserva já gravada precisa continuar existindo no retorno e chegar à família com pagamento.
{
  const acao = {
    slot: { id: "slot-1", label: "quinta-feira (20/08) às 10h" },
    responsavel: "Ana", crianca: "Arthur Silva",
    valorDaConsulta: "R$ 550", prazoPagamento: "até amanhã de manhã", pagarAgora: false,
  };
  const r = recuperarAposFalha({
    historico: [{ role: "assistant", content: "Qual o nome?" }],
    texto: "Ana e Arthur Silva", ctx: contexto({ acoesRealizadas: [acao] }),
  });
  ok(r.acoes.length === 1 && r.acoes[0] === acao, "a ação continua no retorno do cérebro");
  ok(/Deixei separado/.test(r.resposta), "não chama a reserva de confirmação");
  ok(r.resposta.includes("R$ 550") && r.resposta.includes("até amanhã de manhã"),
    "a recuperação informa valor e prazo calculados pelo código");
  ok(r.historico.length === 3 && r.historico[2].content === r.resposta,
    "a resposta de recuperação entra no histórico");
}

// Cancelamento, dados e escalada também não podem desaparecer.
{
  const cancelamento = { crianca: "Lis", label: "segunda-feira às 9h" };
  const r = recuperarAposFalha({ historico: [], texto: "cancela", ctx: contexto({ cancelamentosRealizados: [cancelamento] }) });
  ok(r.cancelamentos.length === 1 && /foi cancelada/.test(r.resposta), "cancelamento é preservado");
}
{
  const dados = { email: "ana@example.com", dataNascimento: null };
  const r = recuperarAposFalha({ historico: [], texto: "meu email", ctx: contexto({ dadosDoPacienteRegistrados: dados }) });
  ok(r.dadosDoPaciente === dados && /Anotei os dados/.test(r.resposta), "dados registrados são preservados");
}
{
  const ctx = contexto({
    escalar: "pedido fora da grade", escalarTipo: "atendimento",
    escalarPergunta: "Liberar 17h?", escalarData: "2026-08-21", escalarHora: "17:00",
  });
  const r = recuperarAposFalha({ historico: [], texto: "preciso 17h", ctx });
  ok(r.escalar === ctx.escalar && r.escalarPergunta === ctx.escalarPergunta,
    "escalada e pergunta continuam no retorno");
  ok(/confirmar isso com o Dr\. Bruno/.test(r.resposta), "família recebe mensagem coerente com a escalada");
  ok(r.horariosOferecidos.length === 1, "estado dos horários oferecidos também é preservado");
}

// A unidade só protege produção se o catch do cérebro realmente passar por ela.
{
  const cerebro = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
  ok(/return recuperarAposFalha\(\{ historico, texto, ctx \}\);/.test(cerebro),
    "o catch do cérebro usa a recuperação com o contexto que executou as ferramentas");
  ok(/ctx\.acoesRealizadas\.push\(acaoRealizada\)/.test(cerebro),
    "a reserva é registrada no contexto assim que a persistência local dá certo");
  ok(/if \(googleEventId\) await GoogleAgenda\.cancelarEvento\(googleEventId\);\s*throw erro;/.test(cerebro),
    "falha ao persistir localmente desfaz o evento já criado no Google");
}

console.log(`\nrecuperacao-apos-falha: ${passou} passaram, ${falhou} falharam`);
if (falhou) {
  erros.forEach((e) => console.log("  FALHOU: " + e));
  process.exit(1);
}
