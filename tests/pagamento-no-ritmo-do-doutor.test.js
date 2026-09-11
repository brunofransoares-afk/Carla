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
const SERVER = LER("server.js"), PAINEL = LER("painel-server.js"), TELA = LER("dashboard.html"), STORAGE = LER("storage-node.js"), CEREBRO = LER("cerebro-ia.js");
const JS = TELA.match(/<script>([\s\S]*)<\/script>/)[1];

// ------------------------------------------------- 1. quem escolhe a reserva é a máquina, ao gravar o alerta
{
  // Auditoria de 10/09: "Pode deixar o pagamento para amanhã?" + Sim marcava pago (a regra lia
  // o texto da pergunta), e "família" continha "lia" (nome como pedaço de palavra). Agora a
  // Carla só diz que o assunto é pagamento; o servidor anexa a reserva ao alerta pelo id.
  const fonte = SERVER.slice(SERVER.indexOf("function alertaDePagamento("), SERVER.indexOf("// O caminho do Sim de pagamento."));
  const marcados = [], eventos = [];
  const reservas = [
    { slotId: "reserva-lia", telefone: "+1", crianca: "Lia", data: "2026-09-15", horario: "20:00", diaLabel: "terça 15/09 às 20:00", pago: false },
    { slotId: "reserva-levi", telefone: "+1", crianca: "Levi Eleuterio de Campos", data: "2026-09-12", horario: "09:00", diaLabel: "sábado 12/09 às 09:00", pago: false },
    { slotId: "reserva-bia", telefone: "+1", crianca: "Bia", data: "2026-09-14", horario: "10:00", diaLabel: "segunda 14/09 às 10:00", pago: true },
    { slotId: "reserva-outro", telefone: "+2", crianca: "Pedro", data: "2026-09-13", horario: "10:00", diaLabel: "domingo 13/09 às 10:00", pago: false },
    { slotId: "reserva-ju", telefone: "+3", crianca: "Ju Família", data: "2026-09-16", horario: "14:00", diaLabel: "quarta 16/09 às 14:00", pago: false },
  ];
  const Storage = {
    lerAgendamentos: () => reservas,
    alterarPagamento: (slotId, pago) => { marcados.push(`${slotId}:${pago}`); return { ok: true, alterado: true }; },
  };
  const Eventos = { registrar: (tipo, tel, dados) => eventos.push({ tipo, tel, ...dados }) };
  const primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0];
  const fns = new Function("Storage", "Eventos", "primeiroNome", fonte + "\nreturn { alertaDePagamento, marcarPagamentoDaReserva };")(Storage, Eventos, primeiroNome);

  const um = fns.alertaDePagamento("+3", { pergunta: "Pode deixar o pagamento para amanhã?" });
  eq(um.pagamentoSlotId, "reserva-ju", "1. uma reserva ativa e não paga: o alerta leva o id dela");
  eq(um.pergunta, "Pagamento da consulta de Ju (quarta 16/09 às 14:00) recebido?", "1b. e a pergunta é escrita pela máquina, com criança e horário");
  ok(!um.opcoes && !um.semReserva, "1c. sem botões extras");

  const dois = fns.alertaDePagamento("+1", { pergunta: "Pagamento recebido?" });
  ok(!dois.pagamentoSlotId, "1d. irmãos: o Sim sozinho não marca ninguém");
  eq(dois.opcoes.map((o) => o.valor).join(","), "pago:reserva-levi,pago:reserva-lia,nenhum", "1e. um botão por reserva não paga, em ordem de data, mais 'Nenhum ainda'; a já paga (Bia) não entra");
  eq(dois.opcoes[0].rotulo, "Levi · sábado 12/09 às 09:00", "1f. o rótulo diz criança e horário");
  eq(dois.pergunta, "Qual pagamento foi recebido?", "1g. e a pergunta é qual");

  const zero = fns.alertaDePagamento("+4", { pergunta: "Pagamento recebido?" });
  ok(zero.semReserva && !zero.pagamentoSlotId && !zero.opcoes && zero.pergunta === "Pagamento recebido?", "1h. sem reserva: o alerta sai sem efeito de pagamento, e o Sim não marca nada");

  eq(fns.marcarPagamentoDaReserva("+1", "reserva-levi").join(","), "reserva-levi", "1i. marcar pelo id marca só aquela");
  eq(marcados.join(","), "reserva-levi:true", "1j. marcada como paga");
  eq(eventos[0].tipo + ":" + eventos[0].slotId + ":" + eventos[0].origem, "pagou:reserva-levi:resposta_do_doutor", "1k. e o funil sabe que foi pelo Sim");
  marcados.length = 0;
  eq(fns.marcarPagamentoDaReserva("+1", "reserva-outro").length + fns.marcarPagamentoDaReserva("+1", "reserva-bia").length + fns.marcarPagamentoDaReserva("+1", "reserva-nao-existe").length, 0, "1l. de outro telefone, já paga ou inexistente: recusa");
  eq(marcados.length, 0, "1m. e não toca em nada");
}

// ------------------------------------------------- 2. o encanamento do Sim
{
  ok(!/PERGUNTA_DE_PAGAMENTO_REGEX|marcarPagamentoPelaResposta|texto\.includes\(primeiroNome/.test(SERVER), "2. não existe mais leitura do texto da pergunta nem nome como pedaço de palavra");
  const bloco = SERVER.slice(SERVER.indexOf("const slotDoPagamento = "), SERVER.indexOf("if (slotDoPagamento) {"));
  const decide = (alerta, resposta) => {
    const opcaoEscolhida = Array.isArray(alerta.opcoes) ? alerta.opcoes.find((o) => o.valor === resposta) : null;
    return new Function("alerta", "respostaNormalizada", "opcaoEscolhida", bloco + "\nreturn slotDoPagamento;")(alerta, resposta, opcaoEscolhida);
  };
  eq(decide({ pergunta: "Pode deixar o pagamento para amanhã?" }, "Sim"), null, "2b. Sim numa pergunta sem reserva anexada não marca nada, por mais que fale em pagamento");
  eq(decide({ pergunta: "Pagamento da consulta de Ju (quarta 16/09 às 14:00) recebido?", pagamentoSlotId: "reserva-ju" }, "Sim"), "reserva-ju", "2c. Sim com reserva anexada marca ela");
  eq(decide({ pergunta: "Pagamento recebido?", pagamentoSlotId: "reserva-ju" }, "Não"), null, "2d. Não não marca");
  const irmaos = { pergunta: "Qual pagamento foi recebido?", opcoes: [{ rotulo: "Levi", valor: "pago:reserva-levi" }, { rotulo: "Nenhum ainda", valor: "nenhum" }] };
  eq(decide(irmaos, "pago:reserva-levi"), "reserva-levi", "2e. o botão da reserva marca só ela");
  eq(decide(irmaos, "nenhum"), null, "2f. 'Nenhum ainda' não marca");
  eq(decide(irmaos, "sim"), null, "2g. e um Sim solto num alerta de irmãos não marca (não há id anexado)");
  ok(/const confirmado = await confirmarPagamentoPeloSim\(\{ alertaId, telefone, sessao, respostaNormalizada, slotId: slotDoPagamento \}\);\s*\n\s*if \(confirmado\) return confirmado;/.test(SERVER), "2h. e quando marcou, a IA não escreve segunda mensagem por cima");
  const helper = SERVER.slice(SERVER.indexOf("async function confirmarPagamentoPeloSim("), SERVER.indexOf("async function responderEscalada("));
  ok(/const marcados = marcarPagamentoDaReserva\(telefone, slotId\);/.test(helper), "2i. o helper marca pelo id");
  ok(/avisos\.push\(await avisarPagamentoConfirmadoNaFila\(slotId\)\)/.test(helper), "2j. a família recebe a mesma confirmação do botão 'pago' (que já pede e-mail e data)");
  ok(helper.indexOf("await avisarPagamentoConfirmadoNaFila(") < helper.indexOf("Storage.responderAlerta(alertaId, respostaNormalizada)"), "2k. e o alerta só fecha depois de a confirmação estar na caixa de saída");
  ok(/NaFila\(slotId\)/.test(helper) && !/await avisarPagamentoConfirmado\(slotId\)/.test(helper), "2l. chama a versão 'NaFila': já estamos na fila desse telefone, e a outra entraria na mesma fila e travaria");
  ok(/if \(!marcados\.length\) return null;/.test(helper), "2m. sem reserva pra marcar, devolve null e a escalada segue como antes");
  // A gravação do alerta: só anexa reserva quando a Carla disse que o assunto é pagamento.
  ok(/const pagamento = resultado\.escalarAssunto === "pagamento"\s*\n\s*\? alertaDePagamento\(telefone, \{ pergunta: resultado\.escalarPergunta \}\) : null;/.test(SERVER), "2n. o bot só anexa reserva quando o assunto é pagamento");
  ok(/pagamentoSlotId: pagamento \? \(pagamento\.pagamentoSlotId \|\| null\) : null,/.test(SERVER) && /opcoes: pagamento \? \(pagamento\.opcoes \|\| null\) : resultado\.escalarOpcoes,/.test(SERVER), "2o. e grava o id ou os botões no alerta");
  ok(/if \(pagamentoSlotId\) registro\.pagamentoSlotId = String\(pagamentoSlotId\)\.slice\(0, 80\);/.test(STORAGE) && /valor: String\(o\.valor \|\| ""\)\.slice\(0, 80\)/.test(STORAGE), "2p. o storage persiste o id, e o valor do botão cabe um 'pago:reserva-<uuid>' inteiro");
  ok(/assunto: \{ type: "string", enum: \["pagamento", "outro"\]/.test(CEREBRO) && /ctx\.escalarAssunto = input\.assunto === "pagamento" \? "pagamento" : "outro";/.test(CEREBRO) && /escalarAssunto: ctx\.escalarAssunto \|\| "outro",/.test(CEREBRO), "2q. a ferramenta tem o assunto, tipado, e ele sai no resultado da IA");
  ok(/Chame escalar_humano com assunto "pagamento"/.test(CEREBRO), "2r. e o prompt manda usar");
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
