/*
 * Bateria do caso liso.
 *
 * Alinhado com o Dr. Bruno em 10/09, depois de um teste em que a família escolheu "2"
 * (puericultura), disse "meu filho está com febre", e a Carla trocou pra urgência sozinha
 * e mandou o bloco de valor inteiro de novo. A regra dele: a Carla resolve só o caso liso.
 * Qualquer decisão (trocar tipo, exceção, questionamento, caso confuso) pausa a conversa e
 * vira alerta pra ele.
 *
 * O que esta bateria vigia:
 *   1. o princípio escrito no prompt, com o que é liso e o que não é
 *   2. o tipo travado no PRIMEIRO valor informado (estado), executado de verdade
 *   3. a trava de máquina em confirmar_agendamento: reserva de outro tipo é recusada com a
 *      instrução de escalar, não com uma "dica" pra trocar
 *   4. a resposta ao menu: número ou nome do tipo; outra coisa pede o número uma vez e
 *      depois escala
 *
 * Roda com:  node tests/caso-liso.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const Estado = require(path.join(__dirname, "..", "estado-atendimento.js"));
const Preco = require(path.join(__dirname, "..", "preco-da-consulta.js"));
const CEREBRO = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
const ESTAVEL = CEREBRO.slice(CEREBRO.indexOf("const PROMPT_ESTAVEL = `"), CEREBRO.indexOf("function limparDadoDinamico("));

// ------------------------------------------------- 1. o princípio
{
  ok(/VOCÊ RESOLVE SÓ O CASO LISO\./.test(ESTAVEL), "1. o princípio está no prompt, no alto, perto do TOM");
  ok(ESTAVEL.indexOf("VOCÊ RESOLVE SÓ O CASO LISO") < ESTAVEL.indexOf("COMO VOCÊ FALA:"), "1b. antes de qualquer regra específica");
  ok(/O que é liso: a família escolhe o tipo pelo número, ouve o valor, diz o período, escolhe um dos horários que a ferramenta devolveu/.test(ESTAVEL), "1c. diz o que é liso, concreto");
  ok(/O que NÃO é liso: qualquer coisa que peça uma decisão\./.test(ESTAVEL), "1d. e o que não é");
  ok(/Família que escolheu um tipo e depois fala de outro, que questiona o tipo, o valor ou uma regra, que pede exceção/.test(ESTAVEL), "1e. com os casos do dia a dia nomeados");
  ok(/você NÃO decide, nem pra um lado nem pro outro: diz que vai confirmar com o Dr\. Bruno e já retorna, chama escalar_humano com a pergunta pronta pra ele responder num toque, e para\./.test(ESTAVEL), "1f. e o que fazer: escalar com pergunta e parar");
  ok(/Errar pra um lado e "resolver" sozinha uma coisa que era dele é pior do que esperar\./.test(ESTAVEL), "1g. com o motivo, que é o que faz a regra pegar");
}

// ------------------------------------------------- 2. o tipo travado no estado
{
  let e = Estado.reiniciarConversa();
  eq(Estado.primeiroPrecoInformado(e), null, "2. conversa nova: nenhum tipo travado");
  e = Estado.registrarPreco(e, 45000, new Date("2026-09-10T17:58:00Z"));
  eq(Estado.primeiroPrecoInformado(e), 45000, "2b. o primeiro valor informado (R$ 450, puericultura) trava");
  e = Estado.registrarPreco(e, 35000, new Date("2026-09-10T17:58:30Z"));
  eq(e.precoInformadoValor, 35000, "2c. o valor 'atual' muda quando a IA repete o bloco com outro tipo (é o print)");
  eq(Estado.primeiroPrecoInformado(e), 45000, "2d. mas o primeiro NÃO muda: é ele que trava o tipo");
  eq(Estado.primeiroPrecoInformado(Estado.normalizar(JSON.parse(JSON.stringify(e)))), 45000, "2e. sobrevive à gravação da sessão (normalizar)");
  eq(Estado.primeiroPrecoInformado(Estado.registrarPreco(Estado.reiniciarConversa(), "abc")), null, "2f. valor inválido não trava nada");
  eq(Preco.tipoDoValor(45000), "puericultura", "2g. R$ 450 é puericultura");
  eq(Preco.tipoDoValor(35000), "urgencia", "2h. R$ 350 é urgência");
  eq(Preco.tipoDoValor(60000), "urgencia", "2i. R$ 600 também é urgência (fim de semana)");
  eq(Preco.tipoDoValor(55000), "tnd", "2j. R$ 550 é neurodesenvolvimento");
  eq(Preco.tipoDoValor(80000), null, "2k. valor desconhecido não é tipo nenhum");
}

// ------------------------------------------------- 3. a trava de máquina na reserva
{
  const ferramenta = CEREBRO.slice(CEREBRO.indexOf('if (nome === "confirmar_agendamento")'), CEREBRO.indexOf('if (nome === "preparar_cancelamento")'));
  ok(/const primeiroValor = EstadoAtendimento\.primeiroPrecoInformado\(ctx\.estadoAtendimento\);/.test(ferramenta), "3. a ferramenta lê o primeiro valor");
  ok(/const tipoTravado = primeiroValor \? Preco\.tipoDoValor\(primeiroValor\) : null;/.test(ferramenta), "3b. e converte em tipo");
  ok(/if \(tipoTravado && tipoTravado !== tipoConsulta\) \{\s*\n\s*return \{\s*\n\s*sucesso: false,\s*\n\s*tipoTravado,/.test(ferramenta), "3c. reservar em outro tipo é recusado");
  ok(/Trocar pra \$\{preco\.nome\} não é decisão sua\. Não reserve\./.test(ferramenta), "3d. dizendo que não é decisão dela");
  ok(/chame escalar_humano com a pergunta pronta \(ex: [^)]*Qual consulta marcar\?"\) e com opcoes com os três tipos \(valores urgencia, puericultura e tnd\), que viram botões no painel/.test(ferramenta), "3e. e mandando escalar com pergunta e os três tipos como opções");
  ok(/A conversa pausa até ele clicar\./.test(ferramenta), "3f. e pausar");
  // A trava vem ANTES da checagem do preço: senão a "dica" de trocar o tipo falaria primeiro.
  ok(ferramenta.indexOf("const tipoTravado =") < ferramenta.indexOf("EstadoAtendimento.precoFoiInformado(ctx.estadoAtendimento, preco.centavos)"), "3g. a trava vem antes da checagem do preço, senão a dica de trocar o tipo fala primeiro");

  // Executa a trava como ela está no arquivo, com o mínimo de contexto ao redor.
  const inicio = ferramenta.indexOf("const primeiroValor =");
  const fim = ferramenta.indexOf("const formasPagamento = LinksPagamento.formasParaPreco(preco.centavos);");
  const trecho = ferramenta.slice(inicio, fim);
  const roda = (estadoAtendimento, tipoConsulta) => new Function("EstadoAtendimento", "Preco", "ctx", "tipoConsulta", "preco",
    trecho + "\nreturn null;")(Estado, Preco, { estadoAtendimento }, tipoConsulta, Preco.precoDaConsulta({ date: "2026-09-14" }, tipoConsulta));
  const escolheuPuericultura = Estado.registrarPreco(Estado.reiniciarConversa(), 45000);
  const r = roda(escolheuPuericultura, "urgencia");
  ok(r && r.sucesso === false && r.tipoTravado === "puericultura", "3h. o caso do print: escolheu puericultura, IA tenta urgência, a ferramenta recusa");
  ok(/A família escolheu consulta de puericultura e agora fala em consulta de urgência\. Qual consulta marcar\?/.test(r.motivo), "3i. com a pergunta pronta pro painel");
  eq(roda(escolheuPuericultura, "puericultura"), null, "3j. o mesmo tipo passa");
  eq(roda(Estado.reiniciarConversa(), "urgencia"), null, "3k. sem valor informado ainda, a trava não opina (a checagem do preço cuida disso)");
  const fds = Estado.registrarPreco(Estado.reiniciarConversa(), 60000);
  eq(roda(fds, "urgencia"), null, "3l. R$ 600 informado e reserva de urgência: mesmo tipo, passa");
}

// ------------------------------------------------- 4. a resposta ao menu
{
  ok(/A resposta que vale é "1", "2" ou "3", ou o nome do tipo por extenso/.test(ESTAVEL), "4. número ou nome do tipo");
  ok(/Se a resposta não for uma dessas \(um sintoma solto, uma pergunta, "não sei"\), peça UMA vez, leve: "Me responde só com o número, 1, 2 ou 3\? 😊"/.test(ESTAVEL), "4b. outra coisa: pede o número uma vez");
  ok(/Se ainda assim não vier, isso não é caso liso: diga que vai confirmar com o Dr\. Bruno e já retorna, e chame escalar_humano/.test(ESTAVEL), "4c. e na segunda, escala");
  ok(/O TIPO NÃO MUDA DEPOIS DE ESCOLHIDO\. Se a família escolheu um tipo e depois disser algo que aponte pra outro/.test(ESTAVEL), "4d. tipo escolhido não muda");
  ok(/"A família escolheu puericultura pro Levi e agora diz que ele está com febre\. Qual consulta marcar\?"/.test(ESTAVEL), "4e. com o exemplo do print virando pergunta pro painel");
  ok(/com opcoes com os três tipos: rótulos "Urgência", "Puericultura" e "Neurodesenvolvimento", valores urgencia, puericultura e tnd\. No painel isso vira três botões/.test(ESTAVEL), "4i. e os três tipos vão como opções, que viram botões");
  ok(/Nunca repita o bloco de valor com outro tipo: isso é a Carla trocando o tipo sozinha, e a ferramenta recusa/.test(ESTAVEL), "4f. e o bloco de valor não se repete com outro tipo");
  ok(!/"Entendo a preocupação 😊 Isso é bem melhor de avaliar na consulta\."/.test(ESTAVEL), "4g. a frase pronta de acolhimento (que saía copiada na tela) virou orientação");
  ok(/acolha com empatia em UMA frase, com as suas palavras daquela vez/.test(ESTAVEL), "4h. de acolher com as próprias palavras");
}

// ------------------------------------------------- 5. as opções: do escalar_humano ao clique no painel
{
  const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const STORAGE = fs.readFileSync(path.join(__dirname, "..", "storage-node.js"), "utf8");
  const TELA = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");
  ok(/opcoes: \{ type: \["array", "null"\], description: "Só quando a decisão do Dr\. Bruno é ENTRE ALTERNATIVAS/.test(CEREBRO), "5. a ferramenta tem o campo opcoes");
  ok(/required: \["rotulo", "valor"\]/.test(CEREBRO), "5b. cada opção tem rótulo (o botão) e valor (o que volta)");

  // O filtro do handler, executado: até 4, só com pergunta, sem lixo.
  const handler = CEREBRO.slice(CEREBRO.indexOf("const opcoes = Array.isArray(input.opcoes)"), CEREBRO.indexOf("ctx.escalarOpcoes = pergunta && opcoes.length >= 2 ? opcoes : null;") + "ctx.escalarOpcoes = pergunta && opcoes.length >= 2 ? opcoes : null;".length);
  const filtra = (input, pergunta) => { const ctx = {}; new Function("input", "pergunta", "ctx", "textoOperacional", handler)(input, pergunta, ctx, (v, n) => String(v || "").trim().slice(0, n)); return ctx.escalarOpcoes; };
  const tres = [{ rotulo: "Urgência", valor: "urgencia" }, { rotulo: "Puericultura", valor: "puericultura" }, { rotulo: "Neurodesenvolvimento", valor: "tnd" }];
  eq(JSON.stringify(filtra({ opcoes: tres }, "Qual?")), JSON.stringify(tres), "5c. três opções com pergunta passam inteiras");
  eq(filtra({ opcoes: tres }, null), null, "5d. sem pergunta não tem botão: o painel não teria o que perguntar");
  eq(filtra({ opcoes: [tres[0]] }, "Qual?"), null, "5e. uma opção só não é escolha");
  eq(filtra({ opcoes: [...tres, ...tres] }, "Qual?").length, 4, "5f. no máximo 4");
  eq(filtra({ opcoes: [{ rotulo: "", valor: "x" }, ...tres] }, "Qual?").length, 3, "5g. opção sem rótulo é descartada");

  ok(/escalarOpcoes: ctx\.escalarOpcoes \|\| null,/.test(CEREBRO), "5h. sai no resultado da IA");
  ok(/opcoes: resultado\.escalarOpcoes,/.test(SERVER), "5i. o bot grava no alerta");
  ok(/opcoes = null \}\) \{/.test(STORAGE) && /registro\.opcoes = opcoes\.slice\(0, 4\)/.test(STORAGE), "5j. o storage persiste, com teto");
  ok(/al\.opcoes\.map\(\(o\) => `<button class="btn-opcao" data-alerta="\$\{escapeHtml\(al\.id\)\}" data-resposta="\$\{escapeHtml\(o\.valor\)\}">\$\{escapeHtml\(o\.rotulo\)\}<\/button>`\)/.test(TELA), "5k. o painel desenha um botão por opção, escapado");
  ok(/Array\.isArray\(al\.opcoes\) && al\.opcoes\.length >= 2\s*\n\s*\? al\.opcoes\.map/.test(TELA) && /: `<button class="btn-sim"/.test(TELA), "5l. com opções, os botões são elas; sem, continua Sim e Não");

  // O clique volta como o valor da opção; o bot destrava o tipo e a Carla lê o rótulo.
  const bloco = SERVER.slice(SERVER.indexOf("const opcaoEscolhida = Array.isArray(alerta.opcoes)"), SERVER.indexOf("// \"SIM\" NUMA PERGUNTA DE PAGAMENTO"));
  ok(/sessao\.recadoDoDoutor\.resposta = opcaoEscolhida\.rotulo;/.test(bloco), "5m. a Carla lê o rótulo, não o valor interno");
  ok(/estado\.primeiroPrecoInformado = Preco\.TIPOS\[opcaoEscolhida\.valor\]\.centavos;/.test(bloco), "5n. e o tipo da conversa é destravado pro que ele escolheu: a trava passa a aceitar esse tipo");
  const aplica = (alerta, resposta, estadoInicial) => { const sessao = { recadoDoDoutor: { pergunta: alerta.pergunta, resposta }, estadoAtendimento: estadoInicial }; new Function("alerta", "respostaNormalizada", "sessao", "Preco", "EstadoAtendimento", bloco)(alerta, resposta, sessao, Preco, Estado); return sessao; };
  const alertaTipo = { pergunta: "Qual consulta marcar?", opcoes: tres };
  const s1 = aplica(alertaTipo, "urgencia", Estado.registrarPreco(Estado.reiniciarConversa(), 45000));
  eq(s1.recadoDoDoutor.resposta, "Urgência", "5o. clicou em Urgência: o recado diz 'Urgência'");
  eq(Estado.primeiroPrecoInformado(s1.estadoAtendimento), 35000, "5p. e o tipo travado virou urgência (R$ 350): a reserva nesse tipo passa a ser aceita");
  const s2 = aplica(alertaTipo, "sim", Estado.registrarPreco(Estado.reiniciarConversa(), 45000));
  eq(Estado.primeiroPrecoInformado(s2.estadoAtendimento), 45000, "5q. resposta que não é uma das opções não mexe em nada");
  const s3 = aplica({ pergunta: "Liberar 17h?", opcoes: [{ rotulo: "Hoje", valor: "hoje" }, { rotulo: "Amanhã", valor: "amanha" }] }, "hoje", Estado.registrarPreco(Estado.reiniciarConversa(), 45000));
  eq(s3.recadoDoDoutor.resposta + "|" + Estado.primeiroPrecoInformado(s3.estadoAtendimento), "Hoje|45000", "5r. opção que não é tipo de consulta só vira recado, sem mexer no tipo");
  ok(/QUANDO A DECISÃO É ENTRE ALTERNATIVAS \(qual tipo de consulta, por exemplo\), preencha a pergunta E o campo opcoes/.test(ESTAVEL), "5s. o prompt ensina quando usar opções");
  ok(/Se ele escolheu uma das opções que você mandou, siga com ela: se for um tipo de consulta, aquele passa a ser o tipo desta conversa \(o sistema já destravou\)/.test(CEREBRO), "5t. e o que fazer quando a resposta é uma opção: seguir com ela, sem menu de novo");
}

console.log(`\ncaso-liso: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
