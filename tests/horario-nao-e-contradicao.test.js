/*
 * Bateria do horário que a Carla achou que tinha errado.
 *
 * Conversa real de 17/08, 08:50 às 09:15. A mãe do Felipe (paciente antigo, tosse) foi
 * atendida, escolheu horário DUAS vezes, e foi embora sem consulta. Em 5 minutos a Carla
 * mandou isto:
 *
 *   09:01  "hoje às 9h30 ou amanhã (18/08) às 14h"
 *   09:03  "amanhã (18/08) tenho às 9h30. O das 14h que mencionei era pra hoje"
 *   09:03  "pra amanhã, terça (18/08), tenho às 9h30. Ou, se preferir, ainda tenho hoje às 14h"
 *   09:05  "desculpa a confusão antes... hoje às 9h30 ou às 11h. NÃO TENHO VAGA AMANHÃ DE MANHÃ"
 *   09:06  "cometi um erro nos horários... hoje às 9h30 ou amanhã (18/08) às 14h"
 *   09:06  "peço desculpa pela confusão... hoje às 9h30 ou às 11h. NÃO TENHO HORÁRIO AMANHÃ"
 *
 * Cinco pedidos de desculpa. A mãe escolheu "amanhã às 9:30" às 09:04 e a Carla respondeu
 * que amanhã não tinha nada. No painel, amanhã 9h30 estava livre o tempo todo.
 *
 * A FERRAMENTA NUNCA MENTIU. Cada uma daquelas listas era verdadeira; o que mudava era o
 * critério da chamada, e a ferramenta devolve no máximo 2 horários por vez:
 *
 *   sem filtro   -> espalha por período: o mais cedo da manhã + o mais cedo da tarde
 *   data=18/08   -> o que bate com amanhã, COMPLETADO com o resto (ver ordem-dos-horarios.js)
 *   urgente=true -> os 2 cronologicamente mais próximos, que naquele momento eram os de hoje
 *
 * Daí os dois defeitos, os dois nossos:
 *
 * 1. CÓDIGO. A lista completada vinha num array só, sem marca. Pedido de "amanhã" voltava
 *    ["amanhã 9h30", "hoje 14h"] e ela oferecia os dois como se fossem amanhã. Na chamada
 *    seguinte a mistura vinha diferente e parecia contradição.
 *
 * 2. PROMPT. Nada dizia que a lista de 2 não é a agenda inteira. Ela leu ausência como
 *    inexistência ("não tenho vaga amanhã") e se retratou de horários verdadeiros. E nada
 *    a impedia de reconsultar DEPOIS de a família já ter escolhido, que é o que produzia
 *    uma lista nova a cada mensagem.
 *
 * Roda com:  node tests/horario-nao-e-contradicao.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const raiz = path.join(__dirname, "..");
const Ordem = require(path.join(raiz, "ordem-dos-horarios.js"));
const { anotarOferta } = require(path.join(raiz, "oferta-de-horarios.js"));

const CEREBRO = fs.readFileSync(path.join(raiz, "cerebro-ia.js"), "utf8");
const PROMPT = CEREBRO.slice(CEREBRO.indexOf("const PROMPT_ESTAVEL = `"), CEREBRO.indexOf("function montarSystemPrompt("));
const SEM_COMENTARIO = PROMPT.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// Slots no mesmo formato que a agenda usa. HOJE = 17/08 (segunda), AMANHÃ = 18/08 (terça),
// que são os dias reais da conversa que gerou esta bateria.
const g = (date, time, weekday) => ({ id: `g-${date}-${time}`, date, time, weekday, label: `${date} ${time}` });
const x = (date, time) => ({ id: `extra-${date}-${time}`, date, time, label: `${date} ${time} (extra)`, extra: true });

// ------------------------------------------------- 1. o caso exato do print
{
  // A mãe pediu AMANHÃ (18/08). A grade tem amanhã 9h30, e completa com hoje 14h porque
  // oferecerSlots nunca deixa a família sem alternativa.
  const grade = [g("2026-08-18", "09:30", 2), g("2026-08-17", "14:00", 1)];
  const extras = [];
  const filtros = { diaPreferido: null, periodo: null, dataPreferida: "2026-08-18" };

  const batem = Ordem.idsQueBatem(grade, extras, filtros);
  ok(batem.has("g-2026-08-18-09:30"), "1. amanhã 9h30 bate com o pedido de amanhã");
  ok(!batem.has("g-2026-08-17-14:00"), "1b. e hoje 14h NÃO bate: era a alternativa, não a resposta");
  eq(batem.size, 1, "1c. exatamente um dos dois bate");

  // O que quebrou a conversa: os dois saíam no mesmo array, indistinguíveis.
  const ordenados = Ordem.ordenarCandidatos(grade, extras, filtros);
  eq(ordenados.length, 2, "1d. os dois continuam na lista (a alternativa não é descartada)");
  eq(ordenados[0].id, "g-2026-08-18-09:30", "1e. e o que bate continua vindo primeiro");
}

// ------------------------------------------------- 2. extra não pode ser confundido com alternativa
{
  // Extra não tem weekday. Se a classificação usasse bate() cru, um extra aberto no painel
  // justamente pro dia pedido seria rotulado "outro dia" e oferecido com um aviso errado,
  // que é o botão do painel virando enfeite outra vez, por uma porta nova.
  const grade = [g("2026-08-24", "08:00", 1)];
  const extras = [x("2026-08-18", "11:00")];
  const batem = Ordem.idsQueBatem(grade, extras, { diaPreferido: 2, periodo: null, dataPreferida: null });
  ok(batem.has("extra-2026-08-18-11:00"), "2. extra do dia pedido conta como resposta, não como alternativa");
  ok(!batem.has("g-2026-08-24-08:00"), "2b. e a segunda-feira distante continua sendo alternativa");
}

// ------------------------------------------------- 3. sem filtro, nada é alternativa
{
  const grade = [g("2026-08-17", "09:30", 1), g("2026-08-18", "14:00", 2)];
  const batem = Ordem.idsQueBatem(grade, [], { diaPreferido: null, periodo: null, dataPreferida: null });
  eq(batem.size, 2, "3. sem pedido específico os dois batem: não existe alternativa a marcar");
}

// ------------------------------------------------- 4. a alternativa pode ser marcada
{
  // Se a família aceitar a alternativa, a Carla precisa poder fechar. Sem isso o
  // confirmar_agendamento recusaria um horário que a própria ferramenta ofereceu.
  const ctx = { horariosOferecidos: new Set() };
  anotarOferta(ctx, {
    horarios: [{ slotId: "g-2026-08-18-09:30", label: "amanhã 9h30" }],
    alternativas: [{ slotId: "g-2026-08-17-14:00", label: "hoje 14h" }],
  });
  ok(ctx.horariosOferecidos.has("g-2026-08-18-09:30"), "4. o horário pedido entra na lista do que dá pra marcar");
  ok(ctx.horariosOferecidos.has("g-2026-08-17-14:00"), "4b. e a alternativa também, senão ela oferece e não consegue fechar");
  eq(ctx.horariosOferecidos.size, 2, "4c. os dois, e só os dois");
}

// ------------------------------------------------- 5. a ferramenta separa e rotula
{
  // A separação roda de verdade aqui. Verificar só por grep deixava passar a versão em que
  // a linha existe e a separação está desligada por dentro (naoBatem sempre vazio) — foi
  // exatamente o que uma mutação escapou antes desta parte existir.
  const livres = [g("2026-08-18", "09:30", 2), g("2026-08-17", "14:00", 1)];
  const ids = Ordem.idsQueBatem(livres, [], { dataPreferida: "2026-08-18", diaPreferido: null, periodo: null });

  const comPedido = Ordem.separar(livres, ids, true);
  eq(comPedido.batem.length, 1, "5. com pedido de dia, só o horário daquele dia é resposta");
  eq((comPedido.batem[0] || {}).id, "g-2026-08-18-09:30", "5b. e é o de amanhã, que foi o pedido");
  eq(comPedido.naoBatem.length, 1, "5c. o outro vira alternativa em vez de sumir");
  eq((comPedido.naoBatem[0] || {}).id, "g-2026-08-17-14:00", "5d. e é o de hoje, que não era o pedido");

  const semPedido = Ordem.separar(livres, ids, false);
  eq(semPedido.batem.length, 2, "5e. sem pedido específico tudo é resposta");
  eq(semPedido.naoBatem.length, 0, "5f. e não existe alternativa a rotular");

  ok(/Ordem\.separar\(livres, idsQueBatem, pediuAlgo\)/.test(CEREBRO),
    "5g. e o cérebro usa essa separação, não uma cópia dele");
  ok(/resultado\.alternativas = naoBatem\.map\(paraIA\)/.test(CEREBRO),
    "5h. o resultado sai com as alternativas num campo separado");
  ok(/resultado\.sobreAsAlternativas/.test(CEREBRO), "5i. e com uma explicação do que elas são");
  ok(/NENHUM horário livre no que a família pediu/.test(CEREBRO),
    "5j. com aviso próprio pro caso pior: nada bate e só sobrou alternativa");
  ok(/Nunca ofereça como se fossem o que ela pediu/.test(CEREBRO),
    "5k. e a instrução de não passar alternativa como resposta");
  ok(/Ordem\.idsQueBatem\(slotsGrade, slotsExtras, filtros\)/.test(CEREBRO),
    "5l. usando a classificação testável, não uma cópia solta dentro do cérebro");
}

// ------------------------------------------------- 6. a lista nunca se apresenta como a agenda
{
  ok(/const LIMITE_DA_LISTA = /.test(CEREBRO), "6. existe um aviso de escopo, num lugar só");
  eq((CEREBRO.match(/escopo = LIMITE_DA_LISTA/g) || []).length, 2,
    "6b. e ele vai nos DOIS caminhos que devolvem horário (normal e urgente)");
  ok(/NÃO é a agenda inteira/.test(CEREBRO), "6c. dizendo o que a lista não é");
  ok(/NUNCA se retrate de um horário que você já ofereceu por ele não aparecer aqui/.test(CEREBRO),
    "6d. e proibindo a retratação, que é o que espantou a família");

  // A frase antiga do urgente terminava em "disponíveis de verdade", que ela lia como lista
  // fechada. Foi logo depois dela que saiu "não tenho vaga amanhã".
  ok(!/Esses são os horários mais próximos disponíveis de verdade/.test(CEREBRO),
    "6e. a frase que soava exaustiva não pode voltar");
  ok(/Não são os únicos: existem outros mais adiante que não cabem nesta lista/.test(CEREBRO),
    "6f. e a nova diz na cara que existem outros");
}

// ------------------------------------------------- 7. o prompt proíbe negar por ausência
{
  ok(/A LISTA DE HORÁRIOS NÃO É A AGENDA INTEIRA/.test(SEM_COMENTARIO), "7. a regra existe no prompt");
  ok(/Ausência não é inexistência/.test(SEM_COMENTARIO), "7b. dita na frase mais curta possível");
  ok(/chame consultar_horarios COM data=aquele dia antes de dizer qualquer coisa sobre ele/.test(SEM_COMENTARIO),
    "7c. com a saída concreta: conferir aquele dia antes de negar aquele dia");
  ok(/só negue se a ferramenta voltar vazia PARA AQUELA DATA/.test(SEM_COMENTARIO),
    "7d. e a única condição em que negar é legítimo");
}

// ------------------------------------------------- 8. o prompt proíbe o pedido de desculpa
{
  // Cinco desculpas em cinco minutos. Cada uma corrigia algo que estava certo, e juntas
  // disseram pra mãe que a agenda daquele consultório não é confiável.
  ok(/NUNCA se retrate de um horário que você já ofereceu/.test(SEM_COMENTARIO),
    "8. a retratação está proibida no prompt, não só no aviso da ferramenta");
  ok(/Resultado novo não é prova de que o anterior estava errado/.test(SEM_COMENTARIO),
    "8b. com o motivo, que é o que faz ela não inventar exceção");
  ok(/cometi um erro/.test(SEM_COMENTARIO) && /conferindo agora certinho/.test(SEM_COMENTARIO),
    "8c. citando as frases que ela realmente escreveu");
  ok(/destrói a confiança da família na agenda inteira/.test(SEM_COMENTARIO),
    "8d. e o custo, que é maior que a consulta perdida");
}

// ------------------------------------------------- 9. escolheu, para de consultar
{
  // Às 09:04 a mãe escreveu "Amanhã às 9:30" — um horário que a Carla tinha oferecido às
  // 09:03. Ali a consulta estava fechada. Ela consultou de novo e perdeu.
  ok(/QUANDO A FAMÍLIA JÁ ESCOLHEU, PARE DE CONSULTAR/.test(SEM_COMENTARIO), "9. a regra existe");
  ok(/NÃO chame consultar_horarios de novo pra "conferir"/.test(SEM_COMENTARIO),
    "9b. e proíbe a reconsulta de conferência, que é a que gera a contradição");
  ok(/você vai achar que se contradisse, e a família vai embora/.test(SEM_COMENTARIO),
    "9c. com a consequência escrita");
  ok(/Só volte a consultar se ELA pedir outro dia\/horário, ou se confirmar_agendamento falhar/.test(SEM_COMENTARIO),
    "9d. e as duas exceções legítimas, senão ela trava quando o horário some de verdade");
}

// ------------------------------------------------- 10. dá pra investigar da próxima vez
{
  // O log gravava a PERGUNTA feita à ferramenta e não a RESPOSTA. Com quatro consultas e
  // seis mensagens contraditórias, era impossível saber pelo log se o erro foi da agenda ou
  // da leitura dela.
  ok(/function registrarSaidaDaFerramenta\(nome, saida\)/.test(CEREBRO), "10. a saída da ferramenta é logada");
  ok(/\[FERRAMENTA ->\]/.test(CEREBRO), "10b. com prefixo próprio, pra dar pra filtrar no pm2 logs");
  ok(/registrarSaidaDaFerramenta\(bloco\.name, await executarFerramenta\(/.test(CEREBRO),
    "10c. no ponto por onde TODA ferramenta passa, não caso a caso");
  ok(/catch \(erro\) \{\s*console\.log\(`\[FERRAMENTA ->\] \$\{nome\}: \(não deu pra serializar/.test(CEREBRO),
    "10d. e um log que nunca derruba a resposta da família se o objeto não serializar");
}

// ------------------------------------------------- 11. o que já funcionava continua
{
  ok(/Ofereça no máximo 2 opções por vez, nunca liste a semana toda/.test(SEM_COMENTARIO),
    "11. duas opções por vez continua");
  ok(/chame consultar_horarios IMEDIATAMENTE, sem perguntar dia ou período antes/.test(SEM_COMENTARIO),
    "11b. e consultar direto, sem perguntar dia antes, também");
  ok(/Nunca invente ou assuma horário livre/.test(SEM_COMENTARIO), "11c. a proibição de inventar horário continua");
  eq(Ordem.ordenarCandidatos([g("2026-08-24", "08:00", 1)], [x("2026-08-18", "11:00")],
    { periodo: null, dataPreferida: "2026-08-18", diaPreferido: null })[0].id, "extra-2026-08-18-11:00",
    "11d. e o extra do painel continua ganhando do horário distante da grade");
}

console.log(`\nhorario-nao-e-contradicao: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
