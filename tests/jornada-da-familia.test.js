/*
 * Bateria da jornada da família.
 *
 * Três prints de 10/09 mostraram o mesmo padrão: regras que nasceram de um caso ruim viraram
 * pressão e desconfiança no texto que a família lê ("precisa ser feito ainda hoje de manhã",
 * "você já tem consulta agendada?", "o Dr. Bruno vai conferir"). O Dr. Bruno pediu: "deixa
 * a jornada legal, faz direitinho". E pediu a pergunta do tipo em menu numerado.
 *
 * O que esta bateria vigia:
 *   1. o menu numerado do tipo: existe, é o único, aceita número ou palavra, não repete
 *   2. os 30 dias de acompanhamento: dúvida depois da consulta vai pro Dr. Bruno, não vira
 *      agendamento novo (e o bot sabe quem está nessa janela, pela agenda)
 *   3. as mensagens fixas (confirmação e lembretes) trazem mapa, o que levar e o que fazer
 *      se atrasar: as três informações obrigatórias de uma confirmação
 *   4. as frases frias que sobravam saíram
 *
 * Roda com:  node tests/jornada-da-familia.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const LER = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const CEREBRO = LER("cerebro-ia.js"), SERVER = LER("server.js");
const ESTAVEL = CEREBRO.slice(CEREBRO.indexOf("const PROMPT_ESTAVEL = `"), CEREBRO.indexOf("function limparDadoDinamico("));
const CONTEXTO = CEREBRO.slice(CEREBRO.indexOf("function montarContextoDoAtendimento("), CEREBRO.indexOf("function montarSystemPrompt("));

// ------------------------------------------------- 1. o menu numerado do tipo
{
  ok(/1\. Urgência: pra um sintoma de agora \(febre, tosse, dor, vômito\)\. O Dr\. Bruno examina e já orienta o que fazer\./.test(ESTAVEL), "1. opção 1, com explicação curta");
  ok(/2\. Puericultura: a consulta de rotina, pra acompanhar crescimento, vacinas, alimentação e desenvolvimento\./.test(ESTAVEL), "1b. opção 2");
  ok(/3\. Neurodesenvolvimento e saúde mental: investigação ou acompanhamento de autismo, TDAH, TOD, atraso de fala, comportamento, ansiedade\./.test(ESTAVEL), "1c. opção 3");
  ok(/Pode responder só com o número\./.test(ESTAVEL), "1d. e diz que pode responder só o número");
  ok(/SEM os preços nessa mensagem: preço vem depois do tipo/.test(ESTAVEL), "1e. sem preço no menu: preço vem depois do tipo");
  ok(/"1" é urgência, "2" é puericultura, "3" é neurodesenvolvimento, e "ele tá com febre" também é urgência, sem você pedir o número/.test(ESTAVEL), "1f. número OU palavra valem igual: ninguém é obrigado a digitar 1");
  ok(/NÃO mande o menu: nomeie o tipo ao informar o valor/.test(ESTAVEL) && /Nunca repita o menu pra quem já contou o caso/.test(ESTAVEL), "1g. quem já contou o caso não recebe menu, nem repetido");
  ok(/Depois que ela respondeu, o número some da conversa: você fala do tipo pelo nome/.test(ESTAVEL), "1h. depois da escolha, fala pelo nome, nunca 'a opção 1'");
  ok(/É a única lista numerada que existe na conversa inteira\./.test(ESTAVEL), "1i. é a única lista numerada");
  ok(/Menu numerado existe num lugar só: a pergunta do tipo de consulta/.test(ESTAVEL), "1j. o TOM abre a exceção, uma só");
  ok(/NUNCA: usar menu numerado fora da pergunta do tipo de consulta,/.test(ESTAVEL), "1k. e a lista NUNCA continua proibindo o resto");
  ok(!/Sem lista numerada, sem parecer formulário/.test(ESTAVEL), "1l. a proibição antiga da pergunta do tipo saiu, senão o prompt se contradiz");
}

// ------------------------------------------------- 2. os 30 dias de acompanhamento
{
  ok(/ESTA FAMÍLIA ESTÁ NOS 30 DIAS DE ACOMPANHAMENTO\./.test(CONTEXTO), "2. o contexto tem o bloco");
  ok(/tudo isso é do Dr\. Bruno, dentro do acompanhamento que a consulta já incluiu, e NÃO é agendamento novo/.test(CONTEXTO), "2b. dúvida depois da consulta não vira agendamento novo");
  ok(/chame escalar_humano com o resumo do que ela trouxe \(sem pergunta de sim ou não: ele vai ler e responder\)/.test(CONTEXTO), "2c. vai pro Dr. Bruno pelo escalar_humano, como texto livre");
  ok(/Não ofereça consulta nova nem pergunte o tipo de consulta, a não ser que a família peça pra marcar outra ou que o Dr\. Bruno mande/.test(CONTEXTO), "2d. e a Carla não empurra consulta nova nem menu pra quem acabou de passar");
  ok(/\$\{consultaRecente \? `/.test(CONTEXTO) && /consultaRecente\.diasDesde/.test(CONTEXTO), "2e. o bloco só entra quando o bot passa a consulta recente, e diz há quantos dias");
  ok(/montarContextoDoAtendimento\(now, pacienteConhecido, portalJaLiberado, guiaJaLiberado, consultaProxima, precisaSeApresentar, recadoDoDoutor, reaquecimento, estadoAtendimento, consultaRecente\)/.test(CEREBRO), "2f. montarSystemPrompt repassa");
  ok(/montarSystemPrompt\(instante, pacienteConhecido, portalJaLiberado, guiaJaLiberado, consultaProxima, precisaSeApresentar, recadoDoDoutor, reaquecimento, estadoNormalizado, consultaRecente\)/.test(CEREBRO), "2g. e responder\\(\\) também");

  // O bot calcula pela agenda de verdade, executado aqui com um Storage de mentira.
  const fonte = SERVER.slice(SERVER.indexOf("const JANELA_ACOMPANHAMENTO_DIAS"), SERVER.indexOf("function sincronizarUltimoAgendamento("));
  const agora = new Date(2026, 8, 10, 12, 0, 0);
  const Agenda = { toDateStr: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` };
  const mk = (lista) => new Function("Storage", "Agenda", fonte + "\nreturn consultaRecenteDe;")({ lerTodosAgendamentos: () => lista }, Agenda);
  const base = { telefone: "+1", crianca: "Levi", diaLabel: "quinta (10/09) às 14h" };
  eq(mk([{ ...base, data: "2026-09-02", horario: "14:00", estado: "pago" }])("+1", agora).diasDesde, 8, "2h. consulta paga há 8 dias: está na janela");
  eq(mk([{ ...base, data: "2026-09-02", horario: "14:00", estado: "reservado" }])("+1", agora).crianca, "Levi", "2i. reservada e não marcada paga também conta: o Dr. Bruno clica 'pago' no ritmo dele");
  eq(mk([{ ...base, data: "2026-08-01", horario: "14:00", estado: "pago" }])("+1", agora), null, "2j. 40 dias atrás: fora da janela");
  eq(mk([{ ...base, data: "2026-09-12", horario: "14:00", estado: "pago" }])("+1", agora), null, "2k. consulta futura não é 'recente'");
  eq(mk([{ ...base, data: "2026-09-02", horario: "14:00", estado: "cancelado" }])("+1", agora), null, "2l. cancelada não conta");
  eq(mk([{ ...base, data: "2026-09-02", horario: "14:00", estado: "pago", telefone: "+2" }])("+1", agora), null, "2m. de outro telefone não conta");
  eq(mk([{ ...base, data: "2026-08-20", horario: "09:00", estado: "pago" }, { ...base, data: "2026-09-05", horario: "14:00", estado: "pago", crianca: "Ana" }])("+1", agora).crianca, "Ana", "2n. com duas, vale a mais recente");
  eq(mk([{ ...base, data: "2026-09-02", horario: "14:00", estado: "pago" }, { ...base, data: "2026-09-12", horario: "14:00", estado: "reservado", crianca: "Futuro" }])("+1", agora).crianca, "Levi", "2p. uma consulta futura marcada não esconde a recente: quem passou há 8 dias continua no acompanhamento");
  ok(/consultaRecente: consultaRecenteDe\(telefone, now\),/.test(SERVER) && /consultaRecente: consultaRecenteDe\(telefone\),/.test(SERVER), "2o. o bot passa nas duas chamadas (mensagem da família e resposta do doutor)");
}

// ------------------------------------------------- 3. as mensagens fixas trazem o que uma confirmação precisa
{
  ok(/const LINK_MAPA = String\(process\.env\.LINK_MAPA \|\| ""\)\.trim\(\)\s*\n\s*\|\| "https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Rua\+Ranulpho\+Alvarenga\+Ferreira,\+61,\+Limeira\+-\+SP";/.test(SERVER), "3. o link do mapa existe, com padrão e .env");
  ok(/const O_QUE_LEVAR = "O que levar: carteira de vacinação, exames recentes se tiver, e os remédios que a criança usa\.";/.test(SERVER), "3b. e a lista do que levar, igual ao FATO do prompt");
  const confirmacao = SERVER.slice(SERVER.indexOf("const texto = `Pagamento recebido!"), SERVER.indexOf("registrarPagamentoNaSessao(a.telefone, a);"));
  ok(/Endereço: Rua Ranulpho Alvarenga Ferreira, 61\\n\$\{LINK_MAPA\}/.test(confirmacao), "3c. a confirmação do pagamento leva o endereço com o mapa");
  ok(/\$\{O_QUE_LEVAR\}/.test(confirmacao), "3d. e o que levar");
  ok(/Se precisar remarcar ou for atrasar, é só me avisar por aqui\./.test(confirmacao), "3e. e o que fazer se atrasar, sem tom de regra");
  ok(!/Qualquer coisa até lá, é só me chamar por aqui\./.test(confirmacao), "3f. no lugar da frase genérica de antes");
  const lembretes = SERVER.slice(SERVER.indexOf("async function enviarLembretes("), SERVER.indexOf("async function enviarLembretes(") + 3000);
  ok(/Passando pra lembrar[^`]*\$\{O_QUE_LEVAR\}/.test(lembretes), "3g. o lembrete da semana antes diz o que levar");
  ok(/hoje é o dia da consulta[^`]*\$\{LINK_MAPA\}[^`]*\$\{O_QUE_LEVAR\}[^`]*Se for atrasar, me avisa por aqui\./.test(lembretes), "3h. o do dia leva mapa, o que levar e o aviso de atraso");
  ok(/Se perguntarem como chegar ou pedirem localização, mande o link do mapa junto do endereço: https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Rua\+Ranulpho/.test(ESTAVEL), "3i. e a Carla sabe mandar o mapa quando perguntam como chegar");
}

// ------------------------------------------------- 4. as frases frias que sobravam
{
  ok(/agradeça e diga que vai avisar o Dr\. Bruno e que a confirmação chega por aqui/.test(ESTAVEL), "4. quando a família diz que pagou, ela avisa, não 'confere'");
  ok(/sem a palavra "conferir", que soa como desconfiança do comprovante/.test(ESTAVEL), "4b. com o motivo escrito");
  ok(!/diga que o Dr\. Bruno vai conferir/.test(ESTAVEL), "4c. a frase antiga saiu");
  ok(/com a pergunta "Pagamento da consulta de \[criança\] \(\[horário\]\) recebido\?": o Sim dele confirma a consulta/.test(ESTAVEL), "4d. e a escalada vem com a pergunta certa, que o Sim do painel entende");
  ok(/Nada de "ainda não monitoro desistências": isso é linguagem de sistema, não de consultório\./.test(ESTAVEL), "4e. 'monitorar desistências' virou frase de gente");
  ok(!/a Carla ainda não monitora desistências/.test(ESTAVEL), "4f. a antiga saiu");
  ok(/direta e leve: "Você prefere de manhã ou à tarde\?" \(ver A PERGUNTA DEPOIS DO VALOR\)/.test(ESTAVEL), "4g. o 'ok' depois do valor puxa pro período, igual ao resto do prompt");
  ok(!/"Quer que eu veja os horários\?"/.test(ESTAVEL), "4h. e não mais 'quer que eu veja os horários?'");
  ok(!/acrescente apenas "A consulta é R\$ 550\."/.test(ESTAVEL), "4i. convênio + preço não cospe mais R$ 550 fixo: o tipo vem antes");
  ok(/nesse caso siga a REGRA SOBRE PREÇO \(o tipo vem antes do valor/.test(ESTAVEL), "4j. e manda pra regra certa");
  ok(!/ver CONVITE PRA AGENDAR\)/.test(ESTAVEL), "4k. nenhuma referência a regra que não existe mais");
  const semComentario = ESTAVEL.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  eq((semComentario.match(/—/g) || []).length, 1, "4l. o único travessão do prompt é o da própria proibição de usar travessão");
  ok(/NUNCA use travessão \(—\)/.test(semComentario), "4m. e é esse");
}

console.log(`\njornada-da-familia: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
