/*
 * Bateria: o pagamento no ritmo do Dr. Bruno.
 *
 * 10/09, consulta do Levi. Reservada às 11:47 pra hoje às 14h. Às 11:52 a família disse que
 * pagou e a Carla perguntou "Pagamento recebido?". Ele respondeu Sim. Às 12:00 a reserva
 * venceu (o prazo antigo era meio-dia), sumiu da agenda da Carla e mandou cancelar no SPI e
 * no Google. Dois defeitos: o Sim não marcava pago, e a reserva vencia sozinha.
 *
 * Agora: o Sim numa pergunta de pagamento É o botão "pago" (marca, registra no funil, manda
 * a mesma confirmação do botão, e só então fecha o alerta); a reserva não vence mais (ver
 * prazo-de-pagamento.test.js); e a ficha tem "Reativar" pra recuperar a que venceu.
 *
 * Roda com:  node tests/pagamento-no-ritmo-do-doutor.test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const LER = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const SERVER = LER("server.js"), PAINEL = LER("painel-server.js"), TELA = LER("dashboard.html");
const JS = TELA.match(/<script>([\s\S]*)<\/script>/)[1];

// ------------------------------------------------- 1. o "Sim" marca pago (a lógica, executada)
{
  // A função que escolhe QUAIS reservas o Sim confirma roda aqui com um Storage de mentira.
  const fonte = SERVER.slice(SERVER.indexOf("function marcarPagamentoPelaResposta("), SERVER.indexOf("async function confirmarPagamentoPeloSim("));
  const marcados = [];
  const Storage = {
    lerAgendamentos: () => [
      { slotId: "levi", telefone: "+1", crianca: "Levi Eleuterio de Campos", pago: false },
      { slotId: "ana", telefone: "+1", crianca: "Ana Clara", pago: false },
      { slotId: "outro", telefone: "+2", crianca: "Pedro", pago: false },
      { slotId: "jaPago", telefone: "+1", crianca: "Bia", pago: true },
    ],
    alterarPagamento: (slotId, pago) => { marcados.push(`${slotId}:${pago}`); return { ok: true, alterado: true }; },
  };
  const eventos = [];
  const Eventos = { registrar: (tipo, tel, dados) => eventos.push({ tipo, tel, ...dados }) };
  const primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0];
  const marcar = new Function("Storage", "Eventos", "primeiroNome", fonte + "\nreturn marcarPagamentoPelaResposta;")(Storage, Eventos, primeiroNome);

  eq(marcar("+1", "Pagamento da consulta do Levi (hoje 14h) recebido?").join(","), "levi", "1. com duas reservas e a pergunta citando o Levi, só a dele");
  eq(marcados.join(","), "levi:true", "1b. marcada como paga");
  eq(eventos[0].tipo + ":" + eventos[0].slotId + ":" + eventos[0].origem, "pagou:levi:resposta_do_doutor", "1c. e o funil sabe que foi pelo Sim");
  marcados.length = 0;
  eq(marcar("+1", "A família diz que pagou as duas. Recebido?").join(","), "levi,ana", "1d. sem citar criança, marca todas as não pagas do telefone");
  eq(marcar("+2", "Pagamento do Pedro recebido?").join(","), "outro", "1e. e nunca a de outro telefone");
  eq(marcar("+3", "Pagamento recebido?").length, 0, "1f. sem reserva não marca nada, e a conversa segue o caminho normal");
  ok(!marcados.includes("jaPago:true"), "1g. a que já estava paga não é tocada");
}

// ------------------------------------------------- 2. o encanamento do Sim
{
  ok(/const PERGUNTA_DE_PAGAMENTO_REGEX = \/pagamento\|pagou\|pago\|pix\|recebid\/i;/.test(SERVER), "2. a pergunta é reconhecida por palavra: o texto é da Carla, não um campo");
  ok(/if \(PERGUNTA_DE_PAGAMENTO_REGEX\.test\(alerta\.pergunta\) && \/\^sim\\b\/i\.test\(respostaNormalizada\)\) \{/.test(SERVER), "2b. só o Sim, só em pergunta de pagamento");
  ok(/const confirmado = await confirmarPagamentoPeloSim\(\{ alertaId, alerta, telefone, sessao, respostaNormalizada \}\);\s*\n\s*if \(confirmado\) return confirmado;/.test(SERVER), "2c. e quando marcou, a IA não escreve segunda mensagem por cima");
  const helper = SERVER.slice(SERVER.indexOf("async function confirmarPagamentoPeloSim("), SERVER.indexOf("async function responderEscalada("));
  ok(/avisos\.push\(await avisarPagamentoConfirmadoNaFila\(slotId\)\)/.test(helper), "2d. a família recebe a mesma confirmação do botão 'pago' (que já pede e-mail e data)");
  ok(helper.indexOf("await avisarPagamentoConfirmadoNaFila(") < helper.indexOf("Storage.responderAlerta(alertaId, respostaNormalizada)"), "2e. e o alerta só fecha depois de a confirmação estar na caixa de saída");
  ok(/NaFila\(slotId\)/.test(helper) && !/await avisarPagamentoConfirmado\(slotId\)/.test(helper), "2f. chama a versão 'NaFila': já estamos na fila desse telefone, e a outra entraria na mesma fila e travaria");
  ok(/if \(!marcados\.length\) return null;/.test(helper), "2g. sem reserva pra marcar, devolve null e a escalada segue como antes");
}

// ------------------------------------------------- 3. reativar, de verdade, num storage de teste
{
  const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "carla-reativar-"));
  const RAIZ = path.join(TEMP, "bot");
  fs.mkdirSync(path.join(RAIZ, "data"), { recursive: true });
  fs.mkdirSync(path.join(RAIZ, "carla-app", "js"), { recursive: true });
  for (const f of ["storage-node.js", "arquivo-atomico.js", "grade-teleconsulta.js"]) fs.copyFileSync(path.join(__dirname, "..", f), path.join(RAIZ, f));
  fs.writeFileSync(path.join(RAIZ, "carla-app", "js", "config.js"), `global.CARLA_CONFIG = { nomesDiaSemana: ["domingo","segunda","terça","quarta","quinta","sexta","sábado"] };`);
  fs.writeFileSync(path.join(RAIZ, "carla-app", "js", "agenda.js"), `
function toDateStr(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }
function gerarSlotsPossiveis() { return [{ id: "grade-2099-09-10-14:00", date: "2099-09-10", time: "14:00", label: "10/09 às 14:00" }]; }
module.exports = { toDateStr, gerarSlotsPossiveis, formatHora: (h) => h };`);
  const Storage = require(path.join(RAIZ, "storage-node.js"));
  const slot = { id: "grade-2099-09-10-14:00", date: "2099-09-10", time: "14:00", label: "quinta (10/09) às 14h" };

  // A reserva nova não vence: sem expiresAt, ela fica na agenda até a consulta.
  const levi = Storage.reservar({ slot, responsavel: "Gustavo", crianca: "Levi", telefone: "+5535984197421", tipoConsulta: "urgencia" });
  eq(levi.expiresAt, null, "3. reserva nova nasce sem vencimento");
  ok(!!Storage.acharAgendamentoPorSlot(levi.slotId), "3b. e está ativa");
  Storage.vencerReservas(new Date("2099-09-10T13:59:00.000Z"));
  ok(!!Storage.acharAgendamentoPorSlot(levi.slotId), "3c. a varredura de vencimento não derruba ela, nem perto do horário");

  // Vencida por um prazo explícito (o mundo antigo), e reativada.
  const vencivel = Storage.reservar({ slot: { ...slot, id: "grade-2099-09-11-09:00", date: "2099-09-11", time: "09:00", label: "sexta (11/09) às 9h" }, responsavel: "Ana", crianca: "Lia", telefone: "+5519000000002", tipoConsulta: "puericultura", expiraEm: "2099-09-10T12:00:00.000Z" });
  Storage.registrarDadosDoPacientePorSlot(vencivel.slotId, { email: "ana@x.com" });
  Storage.vencerReservas(new Date("2099-09-10T12:01:00.000Z"));
  eq(Storage.lerTodosAgendamentos().find((a) => a.slotId === vencivel.slotId).estado, "vencido", "3d. com prazo explícito ela vence (o mecanismo continua existindo pra quem passar um)");
  const r = Storage.reativarAgendamento(vencivel.slotId, new Date("2099-09-10T12:05:00.000Z"));
  ok(r.ok, "3e. reativar funciona");
  ok(r.agendamento.slotId !== vencivel.slotId, "3f. é uma reserva NOVA, com identidade nova: o cancelamento da antiga já pode ter ido pro SPI e pro Google");
  eq(r.agendamento.reativadaDe, vencivel.slotId, "3g. e sabe de quem veio");
  eq(r.agendamento.estado, "reservado", "3h. nasce reservada (o 'pago' continua sendo clique dele)");
  eq(r.agendamento.expiresAt, null, "3i. e sem vencimento");
  eq(r.agendamento.responsavelEmail, "ana@x.com", "3j. o e-mail da família veio junto");
  eq(r.agendamento.crianca + "/" + r.agendamento.tipoConsulta + "/" + r.agendamento.diaLabel, "Lia/puericultura/sexta (11/09) às 9h", "3k. com os mesmos dados");
  eq(Storage.lerTodosAgendamentos().find((a) => a.slotId === vencivel.slotId).estado, "vencido", "3l. a antiga fica no histórico como estava");
  ok(!Storage.reativarAgendamento(r.agendamento.slotId).ok, "3m. reativar uma ativa é recusado");
  ok(!Storage.reativarAgendamento("nao-existe").ok, "3n. e uma que não existe também");

  // Vaga ocupada por outra família no meio do caminho: recusa, não sobrepõe.
  const cancelada = Storage.reservar({ slot: { ...slot, id: "grade-2099-09-12-10:00", date: "2099-09-12", time: "10:00", label: "sábado (12/09) às 10h" }, responsavel: "Bia", crianca: "Théo", telefone: "+5519000000003" });
  Storage.cancelarAgendamento(cancelada.slotId);
  Storage.reservar({ slot: { ...slot, id: "grade-2099-09-12-10:00", date: "2099-09-12", time: "10:00", label: "sábado (12/09) às 10h" }, responsavel: "Outra", crianca: "Outro", telefone: "+5519000000004" });
  const ocupada = Storage.reativarAgendamento(cancelada.slotId, new Date("2099-09-01T00:00:00.000Z"));
  ok(!ocupada.ok && /ocupado por outra família/.test(ocupada.motivo), "3o. vaga já tomada por outra família: recusa com o motivo");

  Storage._fecharBancoAgendamentosParaTeste();
  fs.rmSync(TEMP, { recursive: true, force: true });
}

// ------------------------------------------------- 4. o encanamento do Reativar
{
  ok(/req\.url === "\/interno\/reativar-reserva"/.test(SERVER), "4. o bot tem a rota");
  const rota = SERVER.slice(SERVER.indexOf('"/interno/reativar-reserva"'), SERVER.indexOf('"/interno/reaquecer"'));
  ok(/const r = Storage\.reativarAgendamento\(dados\.slotId\);/.test(rota), "4b. chama o storage");
  ok(/await enfileirarIntegracoesDaReserva\(\{ slotId: r\.agendamento\.slotId \}, r\.agendamento\.telefone\);/.test(rota), "4c. e enfileira SPI e Google de novo, pra reserva nova");
  ok(/Eventos\.registrar\("agendou", r\.agendamento\.telefone/.test(rota), "4d. o funil vê a reativação como agendamento");
  ok(/caminhoPedido === "\/api\/crm\/reativar"/.test(PAINEL) && /encaminharAoBot\("\/interno\/reativar-reserva"/.test(PAINEL), "4e. o painel só encaminha, como os outros botões que mexem no mundo");
  ok(/data-reativar="\$\{escapeHtml\(k\.slotId\)\}"/.test(JS) && /async function reativarConsulta\(botao, slotId\)/.test(JS), "4f. a ficha tem o botão, nas consultas vencidas e canceladas");
  ok(/if \(!confirm\("Reativar esta consulta\?/.test(JS), "4g. com confirmação: vai de novo pro SPI e pro Google");
}

console.log(`\npagamento-no-ritmo-do-doutor: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
