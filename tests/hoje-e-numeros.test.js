/*
 * Bateria: a tela Hoje e os Números (funções que vieram da Oculoplastic).
 *
 * painel-hoje.js é módulo puro (recebe listas, devolve listas), então cada regra roda com dados
 * inventados. O que a bateria trava, nesta ordem: a taxa de passagem e o gargalo do funil; as
 * seis pendências do dia e quando cada uma NÃO aparece; o follow-up de 7 e 30 dias; mês contra
 * mês e semana, sempre com "sem dado" no lugar de zero inventado; faturamento recebido; origem
 * e motivo de perda gravados no crm.json sem quebrar contato antigo.
 *
 * Roda com:  node tests/hoje-e-numeros.test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const Crm = require(path.join(__dirname, "..", "crm.js"));
const Hoje = require(path.join(__dirname, "..", "painel-hoje.js"));

// Quinta-feira, 10/09/2026, meio-dia.
const AGORA = new Date(2026, 8, 10, 12, 0, 0);
const diasAtras = (d) => new Date(AGORA.getTime() - d * 86400e3).toISOString();
const contato = (extra = {}) => ({ telefone: "+5519000000001", nome: "Ana", ehPaciente: false, ultimaAtividade: diasAtras(0.1), ultimaMensagem: "", fechou: false, aguardandoHumano: false, silenciado: false, ...extra });
const consulta = (extra = {}) => ({ slotId: "r1", telefone: "+5519000000001", data: "2026-09-12", horario: "09:00", crianca: "Miguel", responsavel: "Ana", estado: "reservado", pago: false, tipoConsulta: "puericultura", registradoEm: diasAtras(3), ...extra });
function montar({ contatos = [contato()], agendamentos = [], flags = [], dadosCrm = null } = {}) {
  return Crm.montarCrm({ contatos, agendamentos, funilContatos: flags, dadosCrm, agora: AGORA });
}
const pendencias = (opcoes) => Hoje.pendenciasDoDia({ contatos: montar(opcoes).contatos, eventos: opcoes.eventos || [], agora: AGORA });
const tipos = (p) => p.itens.map((i) => i.tipo);

// ------------------------------------------------- 1. funil: taxa de passagem e gargalo
{
  const etapas = [
    { chave: "contatos", rotulo: "Chamaram", quantidade: 100 },
    { chave: "recebeuPreco", rotulo: "Souberam o valor", quantidade: 80 },
    { chave: "recebeuHorario", rotulo: "Receberam horário", quantidade: 72 },
    { chave: "agendou", rotulo: "Agendaram", quantidade: 18 },
    { chave: "pagou", rotulo: "Pagaram", quantidade: 15 },
  ];
  const r = Hoje.passagensDoFunil(etapas);
  eq(r.passagens.length, 4, "1. uma passagem entre cada par de etapas");
  eq(r.passagens[0].pct, 80, "1b. 80 de 100 passaram: 80%");
  eq(r.passagens[2].pct, 25, "1c. 18 de 72: 25%");
  eq(r.gargalo.deChave, "recebeuHorario", "1d. o gargalo é a passagem de pior taxa, não a de mais gente");
  ok(r.passagens[2].gargalo && !r.passagens[0].gargalo, "1e. só a pior vem marcada");

  // Taxa pior mas base pequena não é gargalo.
  const pequena = Hoje.passagensDoFunil([
    { chave: "contatos", rotulo: "Chamaram", quantidade: 40 },
    { chave: "recebeuPreco", rotulo: "Souberam", quantidade: 20 },
    { chave: "recebeuHorario", rotulo: "Horário", quantidade: 2 },
    { chave: "agendou", rotulo: "Agendaram", quantidade: 0 },
  ]);
  eq(pequena.gargalo.deChave, "recebeuPreco", "1f. 0 de 2 famílias (base pequena) não vira gargalo: fica a pior com base suficiente");

  const vazio = Hoje.passagensDoFunil([{ chave: "contatos", rotulo: "Chamaram", quantidade: 0 }, { chave: "recebeuPreco", rotulo: "Souberam", quantidade: 0 }]);
  eq(vazio.gargalo, null, "1g. funil vazio não tem gargalo");
  eq(vazio.passagens[0].pct, null, "1h. e a taxa é desconhecida, não 0%");
  eq(Hoje.passagensDoFunil(undefined).passagens.length, 0, "1i. sem etapas, sem quebrar");
}

// ------------------------------------------------- 2. pendências do dia
{
  const resp = pendencias({ contatos: [contato({ aguardandoHumano: true, ultimaMensagem: "Preciso falar com o doutor" })] });
  eq(tipos(resp).join(), "responder", "2. aguardando o Dr. Bruno vira 'responder'");
  eq(resp.itens[0].telefone, "+5519000000001", "2b. com o telefone, que leva à ficha e à conversa");

  const pag = pendencias({ agendamentos: [consulta()] });
  ok(tipos(pag).includes("pagamento"), "2c. reserva sem Pago é pagamento pendente");
  ok(/12\/09 às 09:00/.test(pag.itens.find((i) => i.tipo === "pagamento").motivo), "2d. e diz quando é a consulta");
  const paga = pendencias({ agendamentos: [consulta({ estado: "pago", pago: true })] });
  ok(!tipos(paga).includes("pagamento"), "2e. paga, sai da lista");

  // Retorno de 3 meses: consulta em 12/06 faz 3 meses em 12/09, que é daqui a 2 dias.
  const ret = pendencias({ agendamentos: [consulta({ data: "2026-06-12", estado: "pago", pago: true })] });
  ok(tipos(ret).includes("retorno"), "2f. retorno de 3 meses chegando entra");
  const avisado = pendencias({ agendamentos: [consulta({ data: "2026-06-12", estado: "pago", pago: true })], dadosCrm: { ...Crm.lerCrm("/nao/existe"), retornos: { "+5519000000001": { "miguel|2026-06-12:3": diasAtras(1) } } } });
  ok(!tipos(avisado).includes("retorno"), "2g. marcado como avisado, sai");

  // Pós-consulta: consulta de anteontem, sem mensagem do consultório depois.
  const ag = [consulta({ data: "2026-09-08", estado: "pago", pago: true })];
  const pos = pendencias({ agendamentos: ag });
  ok(tipos(pos).includes("pos_consulta"), "2h. consulta de 2 dias atrás pede o 'como está?'");
  const falou = pendencias({ agendamentos: ag, eventos: [{ tipo: "mensagem_manual", telefone: "+5519000000001", em: new Date(2026, 8, 9, 10).toISOString() }] });
  ok(!tipos(falou).includes("pos_consulta"), "2i. se o consultório já escreveu depois da consulta, não pede de novo");
  const antiga = pendencias({ agendamentos: [consulta({ data: "2026-08-20", estado: "pago", pago: true })] });
  ok(!tipos(antiga).includes("pos_consulta"), "2j. consulta de 21 dias atrás já passou da hora do 'como está?'");

  // Ordem: responder antes de pagamento antes do resto.
  const mistura = pendencias({
    contatos: [contato({ telefone: "+55191", nome: "Zé", aguardandoHumano: false }), contato({ telefone: "+55192", nome: "Bia", aguardandoHumano: true })],
    agendamentos: [consulta({ telefone: "+55191", slotId: "x" })],
  });
  eq(tipos(mistura).join(), "responder,pagamento", "2k. responder vem antes de pagamento");
  eq(mistura.total, 2, "2l. o total confere");
  eq(mistura.porTipo.responder, 1, "2m. e a contagem por tipo");
  eq(pendencias({ contatos: [] }).total, 0, "2n. sem contato, sem pendência");
}

// ------------------------------------------------- 2b. parou depois do valor (janela quente, antes dos 7 dias)
{
  const flags = [{ telefone: "+5519000000001", recebeuPreco: true, primeiraPergunta: "preco" }];
  const quente = pendencias({ contatos: [contato({ ultimaAtividade: diasAtras(1) })], flags });
  eq(tipos(quente).join(), "parou_valor", "2o. soube o valor ontem e sumiu: aparece em 'parou depois do valor'");
  const recente = pendencias({ contatos: [contato({ ultimaAtividade: diasAtras(0.1) })], flags });
  eq(tipos(recente).length, 0, "2p. falou há poucas horas: ainda pode estar conferindo o extrato");
  const jaFollow = pendencias({ contatos: [contato({ ultimaAtividade: diasAtras(8) })], flags });
  eq(tipos(jaFollow).join(), "followup7", "2q. a partir de 7 dias a pessoa passa pra follow-up, sem aparecer duas vezes");
}

// ------------------------------------------------- 3. follow-up de 7 e 30 dias
{
  const lead = (dias, extra = {}) => contato({ ultimaAtividade: diasAtras(dias), ...extra });
  const flagsPreco = [{ telefone: "+5519000000001", recebeuPreco: true, primeiraPergunta: "preco" }];
  const f = (dias, opcoes = {}) => pendencias({ contatos: [lead(dias)], flags: flagsPreco, ...opcoes });

  ok(!tipos(f(5)).some((t) => t.startsWith("followup")), "3. 5 dias parado ainda não é follow-up");
  eq(tipos(f(8)).join(), "followup7", "3b. 8 dias parado: follow-up de 7");
  eq(tipos(f(35)).join(), "followup30", "3c. 35 dias parado: follow-up de 30");
  ok(!tipos(f(61)).some((t) => t.startsWith("followup")), "3d. passou de 60 dias, sai da lista do dia");

  const semProposta = pendencias({ contatos: [lead(8)], flags: [{ telefone: "+5519000000001", primeiraPergunta: "outro" }] });
  ok(!tipos(semProposta).length, "3e. quem só disse 'oi' e nunca soube o valor não tem o que cobrar");
  const convenio = pendencias({ contatos: [lead(8)], flags: [{ telefone: "+5519000000001", recebeuPreco: true, primeiraPergunta: "convenio" }] });
  ok(!tipos(convenio).length, "3f. convênio não é lead particular");

  const falou = f(8, { eventos: [{ tipo: "reaquecido", telefone: "+5519000000001", em: diasAtras(1) }] });
  ok(!tipos(falou).length, "3g. retomada enviada ontem: o follow-up de 7 está feito");
  const registrado = pendencias({ contatos: [lead(8)], flags: flagsPreco, dadosCrm: { ...Crm.lerCrm("/nao/existe"), followups: { "+5519000000001": [{ prazo: 7, em: diasAtras(0.5) }] } } });
  ok(!tipos(registrado).length, "3h. follow-up registrado na ficha também tira da lista");
  const feitoNoDia1 = f(8, { eventos: [{ tipo: "mensagem_manual", telefone: "+5519000000001", em: diasAtras(7.5) }] });
  eq(tipos(feitoNoDia1).join(), "followup7", "3i. mensagem logo depois da conversa não conta como follow-up de 7 dias");

  ok(!tipos(pendencias({ contatos: [lead(8, { silenciado: true })], flags: flagsPreco })).length, "3j. silenciado não entra");
  ok(!tipos(pendencias({ contatos: [lead(8)], flags: flagsPreco, dadosCrm: { ...Crm.lerCrm("/nao/existe"), perdas: { "+5519000000001": { motivo: "preco", em: diasAtras(2) } } } })).length, "3k. perdido não entra");
  ok(!tipos(pendencias({ contatos: [lead(8)], flags: flagsPreco, agendamentos: [consulta()] })).some((t) => t.startsWith("followup")), "3l. quem tem consulta marcada não entra");
}

// ------------------------------------------------- 4. faturamento, mês e semana
{
  const ag = (extra) => consulta({ estado: "pago", pago: true, ...extra });
  const fonte = {
    contatosFunil: [{ telefone: "a", primeiroContatoEm: "2026-08-12T10:00:00" }, { telefone: "b", primeiroContatoEm: "2026-09-03T10:00:00" }, { telefone: "c", primeiroContatoEm: "2026-09-09T10:00:00" }],
    agendamentos: [
      ag({ slotId: "1", data: "2026-08-20", pagoEm: "2026-08-19T10:00:00", registradoEm: "2026-08-15T10:00:00", tipoConsulta: "puericultura" }),
      ag({ slotId: "2", data: "2026-09-04", pagoEm: "2026-09-03T10:00:00", registradoEm: "2026-09-02T10:00:00", tipoConsulta: "urgencia" }),
      ag({ slotId: "3", data: "2026-09-09", pagoEm: "2026-09-08T10:00:00", registradoEm: "2026-09-07T10:00:00", tipoConsulta: "tnd" }),
      ag({ slotId: "4", data: "2026-09-09", pagoEm: "2026-09-08T11:00:00", registradoEm: "2026-09-07T11:00:00", tipoConsulta: null }),
      consulta({ slotId: "5", registradoEm: "2026-09-09T10:00:00" }),
    ],
  };
  const m = Hoje.comparacaoMensal(fonte, AGORA);
  eq(m.atual.novosContatos, 2, "4. dois contatos novos em setembro");
  eq(m.atual.consultasMarcadas, 4, "4b. quatro consultas marcadas em setembro");
  eq(m.atual.consultasPagas, 3, "4c. três pagas");
  eq(m.atual.faturamentoCentavos, 35000 + 55000, "4d. faturamento = preço da tabela das pagas com tipo (350 + 550)");
  eq(m.atual.pagasSemValor, 1, "4e. a paga sem tipo fica de fora da soma e é contada à parte");
  eq(m.anterior.faturamentoCentavos, 45000, "4f. agosto: puericultura R$ 450");
  eq(m.anterior.novosContatos, 1, "4g. e um contato novo");
  ok(m.anteriorParcial, "4h. o registro começou no meio de agosto: o mês anterior é avisado como parcial");

  const semHistorico = Hoje.comparacaoMensal({ contatosFunil: [{ primeiroContatoEm: "2026-09-02T10:00:00" }], agendamentos: [] }, AGORA);
  eq(semHistorico.anterior, null, "4i. sem registro antes do mês, o mês anterior é 'sem dado' (null), não zero");
  const nada = Hoje.comparacaoMensal({ contatosFunil: [], agendamentos: [] }, AGORA);
  ok(nada.semDado && nada.anterior === null, "4j. sem nenhum registro, tudo é sem dado");

  const w = Hoje.relatorioSemanal(fonte, AGORA, 3);
  eq(w.atual.de, "2026-09-07", "4k. a semana começa na segunda-feira");
  eq(w.passada.de, "2026-08-31", "4l. a anterior é a de 31/08");
  eq(w.atual.consultasPagas, 2, "4m. duas pagas nesta semana (08/09)");
  eq(w.passada.consultasPagas, 1, "4n. uma na semana fechada (03/09)");
  ok(/Semana de 31\/08 a 06\/09: 1 contato novo, 1 consulta marcada, 1 paga\. Faturamento recebido: R\$ 350,00\./.test(w.texto), "4o. o texto copiável da semana fechada: " + w.texto);
  eq(w.pendenciasAbertas, 3, "4p. leva as pendências abertas");
  const wVazio = Hoje.relatorioSemanal({ contatosFunil: [], agendamentos: [] }, AGORA);
  ok(wVazio.passada.semDado && /sem dado ainda/.test(wVazio.texto), "4q. semana sem registro diz 'sem dado ainda'");
  const wSemTipo = Hoje.textoDaSemana({ semDado: false, rotulo: "01/09 a 07/09", novosContatos: 0, consultasMarcadas: 1, consultasPagas: 1, faturamentoCentavos: 0, pagasSemValor: 1 });
  ok(/Faturamento recebido: sem dado ainda/.test(wSemTipo), "4r. paga sem tipo não vira R$ 0,00");
  eq(Hoje.iniciarSemana(new Date(2026, 8, 13, 23, 0)).getDate(), 7, "4s. domingo ainda é da semana que começou na segunda 07");
}

// ------------------------------------------------- 5. origem e motivo de perda
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carla-hoje-"));
  const arq = path.join(dir, "crm.json");
  const T = "+5519000000001";

  // Arquivo de antes da repaginada: só notas.
  fs.writeFileSync(arq, JSON.stringify({ notas: { [T]: [{ id: "n1", em: AGORA.toISOString(), texto: "oi" }] }, etiquetas: {}, consultasRealizadas: {}, retornos: {} }));
  const antigo = Crm.lerCrm(arq);
  eq(JSON.stringify(antigo.origens), "{}", "5. arquivo antigo: origens vazias, sem quebrar");
  eq(Crm.listaDeOrigens(antigo).join("|"), Crm.ORIGENS_PADRAO.join("|"), "5b. sem lista própria vale a lista padrão");
  ok(Crm.listaDeOrigens(antigo).includes("Instagram") && Crm.listaDeOrigens(antigo).includes("Google"), "5c. Instagram e Google estão na lista");
  const c0 = Crm.montarCrm({ contatos: [contato()], agendamentos: [], funilContatos: [], dadosCrm: antigo, agora: AGORA }).contatos[0];
  ok(c0.origem === null && c0.perda === null && Array.isArray(c0.followups), "5d. contato antigo funciona sem origem, perda e follow-up");

  eq(Crm.definirOrigem(arq, T, "Instagram").ok, true, "5e. grava a origem");
  const depois = Crm.lerCrm(arq);
  eq(depois.origens[T], "Instagram", "5f. a origem ficou no arquivo");
  eq(depois.notas[T].length, 1, "5g. e a nota antiga continua lá");
  Crm.adicionarNota(arq, T, "outra nota");
  eq(Crm.lerCrm(arq).origens[T], "Instagram", "5h. gravar uma nota não apaga a origem");
  eq(Crm.definirOrigem(arq, T, "").origem, null, "5i. texto vazio tira a origem");
  Crm.definirOrigem(arq, T, "Instagram");

  eq(Crm.acrescentarOrigem(arq, "Escola").ok, true, "5j. acrescenta uma origem nova à lista");
  ok(Crm.listaDeOrigens(Crm.lerCrm(arq)).includes("Escola"), "5k. e ela aparece na lista");
  eq(Crm.acrescentarOrigem(arq, "escola").ok, false, "5l. a mesma origem em outra caixa é recusada");
  eq(Crm.retirarOrigem(arq, "Escola").ok, true, "5m. tira da lista");
  eq(Crm.lerCrm(arq).origens[T], "Instagram", "5n. e a origem das famílias fica");

  eq(Crm.definirPerda(arq, T, "inventado").ok, false, "5o. motivo fora da lista é recusado");
  eq(Crm.definirPerda(arq, T, "preco", AGORA).ok, true, "5p. grava a perda com motivo");
  const perdido = Crm.montarCrm({ contatos: [contato()], agendamentos: [], funilContatos: [], dadosCrm: Crm.lerCrm(arq), agora: AGORA }).contatos[0];
  eq(perdido.perda.rotulo, "Achou caro", "5q. a ficha traz o motivo escrito");
  ok(perdido.situacoes.includes("perdido"), "5r. e a situação 'perdido' vira filtro");
  const voltou = Crm.montarCrm({ contatos: [contato()], agendamentos: [consulta()], funilContatos: [], dadosCrm: Crm.lerCrm(arq), agora: AGORA }).contatos[0];
  ok(!voltou.situacoes.includes("perdido") && voltou.perda === null, "5s. quem voltou e marcou consulta deixa de ser perdido");
  eq(Crm.definirPerda(arq, T, null).ok, true, "5t. reabrir");
  eq(Crm.lerCrm(arq).perdas[T], undefined, "5u. tira do arquivo");

  eq(Crm.registrarFollowup(arq, T, 7, AGORA).ok, true, "5v. registra follow-up de 7 dias");
  eq(Crm.registrarFollowup(arq, T, 15, AGORA).ok, false, "5w. prazo fora de 7 e 30 é recusado");
  eq(Crm.lerCrm(arq).followups[T].length, 1, "5x. fica guardado");
  const recorte = Crm.recortarCrmDoTelefone(Crm.lerCrm(arq), T);
  ok(recorte.origens[T] === "Instagram" && recorte.followups[T].length === 1 && Array.isArray(recorte.listaOrigens), "5y. o recorte da ficha leva os campos novos");
  fs.rmSync(dir, { recursive: true, force: true });

  // As contas por origem e por motivo.
  const crm = Crm.montarCrm({
    contatos: [contato({ telefone: "a" }), contato({ telefone: "b" }), contato({ telefone: "c" }), contato({ telefone: "d" })],
    agendamentos: [consulta({ telefone: "a", slotId: "a1" })],
    funilContatos: [],
    dadosCrm: { ...Crm.lerCrm("/nao/existe"), origens: { a: "Instagram", b: "Instagram", c: "Google" }, perdas: { b: { motivo: "preco", em: AGORA.toISOString() }, d: { motivo: "preco", em: AGORA.toISOString() } } },
    agora: AGORA,
  });
  const r = Hoje.origensEPerdas(crm.contatos, Crm.MOTIVOS_PERDA);
  eq(r.origens.lista[0].origem, "Instagram", "5z. a origem com mais famílias vem primeiro");
  eq(r.origens.lista[0].total, 2, "5za. duas vieram do Instagram");
  eq(r.origens.lista[0].fecharam, 1, "5zb. uma fechou consulta");
  eq(r.origens.lista[0].taxa, 50, "5zc. taxa de 50%");
  eq(r.origens.semOrigem, 1, "5zd. uma família sem origem informada, contada à parte");
  eq(r.perdas.lista[0].total, 2, "5ze. dois perdidos por preço");
  const vazio = Hoje.origensEPerdas([contato()].map((c) => ({ ...c, situacoes: [], estagio: { chave: "contatos" } })), Crm.MOTIVOS_PERDA);
  ok(vazio.origens.semDado && vazio.perdas.semDado, "5zf. nenhuma origem e nenhuma perda: sem dado, não zero");
}

// ------------------------------------------------- 6. a rota e a tela falam as mesmas coisas
{
  const painel = fs.readFileSync(path.join(__dirname, "..", "painel-server.js"), "utf8");
  for (const rota of ["/api/numeros", "/api/crm/origem", "/api/crm/origens", "/api/crm/perda", "/api/crm/followup"]) {
    ok(painel.includes(`"${rota}"`), "6. rota " + rota);
  }
  ok(/Hoje\.passagensDoFunil\(f\.etapas\)/.test(painel), "6b. o funil devolve a taxa de passagem e o gargalo");
  ok(/pendencias/.test(painel) && /Hoje\.pendenciasDoDia/.test(painel), "6c. o CRM devolve as pendências do dia");
}

console.log(`hoje-e-numeros: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
