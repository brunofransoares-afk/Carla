/*
 * Bateria do registro do funil.
 *
 * O sistema guardava só ESTADO ATUAL. O histórico da conversa some depois de 4h de silêncio
 * e a sessão mantém só a última mensagem, então a pergunta que decide o negócio — "quantas
 * famílias perguntaram o valor este mês e em que ponto sumiram?" — não tinha resposta. O
 * dado passava e evaporava.
 *
 * A alternativa proposta era uma planilha preenchida à mão por uma secretária. Não existe
 * secretária, e a Carla já leu cada mensagem. O que faltava era gravar.
 *
 * O RECORTE QUE MUDA A LEITURA DO NEGÓCIO é separar quem pergunta PREÇO de quem pergunta
 * CONVÊNIO. Quem chega perguntando de Unimed nunca foi lead particular. Contar os dois no
 * mesmo balde faz 30 contatos com 3 consultas parecer "95% fogem do preço" quando na
 * verdade dois terços nunca foram público. Por isso o classificador tem bateria própria.
 *
 * Roda com:  node tests/registro-de-eventos.test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

// Cópia do módulo num diretório temporário: ele grava em ./data ao lado de si mesmo, então
// sem isso a bateria sujaria os dados de verdade.
const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), "carla-eventos-"));
fs.copyFileSync(path.join(__dirname, "..", "registro-de-eventos.js"), path.join(RAIZ, "registro-de-eventos.js"));
const Eventos = require(path.join(RAIZ, "registro-de-eventos.js"));

const FONTE = fs.readFileSync(path.join(__dirname, "..", "registro-de-eventos.js"), "utf8");
const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const PAINEL = fs.readFileSync(path.join(__dirname, "..", "painel-server.js"), "utf8");

// ------------------------------------------------- 1. o classificador
{
  const casos = [
    ["Gostaria de saber o valor da consulta com o Dr Bruno", "preco"],
    ["Preço?", "preco"],
    ["quanto custa", "preco"],
    ["O Dr Bruno atende Unimed?", "convenio"],
    ["vcs aceitam plano de saude?", "convenio"],
    ["atende pela Amil?", "convenio"],
    ["Gostaria de agendar uma consulta com o Dr", "agendar"],
    ["tem horário essa semana?", "agendar"],
    ["Tá com muita tosse", "sintoma"],
    ["meu filho tem febre ha 2 dias", "sintoma"],
    ["Bom dia", "outro"],
    ["Tudo bem?", "outro"],
    ["Bebê 10 meses", "outro"],
  ];
  let certos = 0;
  for (const [texto, esperado] of casos) {
    if (Eventos.classificar(texto) === esperado) certos++;
    else erros.push(`1. classificou ${JSON.stringify(texto)} como "${Eventos.classificar(texto)}", esperava "${esperado}"`);
  }
  if (certos === casos.length) passou++; else falhou++;
  ok(certos === casos.length, `1. o classificador acertou ${certos}/${casos.length}`);
}

// ------------------------------------------------- 2. a ordem da classificação não é arbitrária
{
  // Estes três casos são a razão de a ordem ser convênio > preço > sintoma > agendar.
  eq(Eventos.classificar("quanto custa pelo convenio?"), "convenio",
    "2. preço PELO CONVÊNIO é lead de convênio, não de preço");
  eq(Eventos.classificar("queria marcar, quanto custa?"), "preco",
    "2b. quem quer marcar mas pergunta o valor está decidindo pelo valor");
  eq(Eventos.classificar("queria marcar, meu filho está com febre"), "sintoma",
    "2c. quem já disse o caso, o caso é o que importa");
}

// ------------------------------------------------- 3. acento e caixa não podem atrapalhar
{
  eq(Eventos.classificar("QUAL O VALOR DA CONSULTA"), "preco", "3. caixa alta");
  eq(Eventos.classificar("qual o valor da consulta"), "preco", "3b. caixa baixa");
  eq(Eventos.classificar("convênio"), "convenio", "3c. com acento");
  eq(Eventos.classificar("convenio"), "convenio", "3d. sem acento");
  eq(Eventos.classificar(""), "outro", "3e. vazio não estoura");
  eq(Eventos.classificar(null), "outro", "3f. nulo não estoura");
}

// ------------------------------------------------- 4. grava e lê de volta
{
  ok(Eventos.registrar("contato", "+5519999999999", {}, new Date("2026-08-17T12:00:00Z")),
    "4. grava um evento");
  ok(Eventos.registrar("mensagem", "+5519999999999", { classe: "preco" }, new Date("2026-08-17T12:01:00Z")),
    "4b. grava outro");
  const lidos = Eventos.lerEventos();
  eq(lidos.length, 2, "4c. lê os dois de volta");
  eq(lidos[0].tipo, "contato", "4d. na ordem em que foram gravados");
  eq(lidos[1].classe, "preco", "4e. com os campos extras preservados");
}

// ------------------------------------------------- 5. linha corrompida custa UMA linha
{
  // O arquivo cresce pra sempre. Uma queda no meio de um append não pode inutilizar meses.
  fs.appendFileSync(Eventos.ARQ_EVENTOS, '{"em":"2026-08-17T12:02:00Z","tipo":"agend\n', "utf8");
  Eventos.registrar("pagou", "+5519999999999", {}, new Date("2026-08-17T12:03:00Z"));
  const lidos = Eventos.lerEventos();
  eq(lidos.length, 3, "5. a linha quebrada é pulada e o resto continua legível");
  eq(lidos[2].tipo, "pagou", "5b. inclusive o que veio DEPOIS da linha quebrada");
}

// ------------------------------------------------- 6. o funil, com o caso da Kátia
{
  fs.unlinkSync(Eventos.ARQ_EVENTOS);
  const t = (m) => new Date(`2026-08-17T12:${String(m).padStart(2, "0")}:00Z`);

  // Kátia: chegou, perguntou nada de preço (queria agendar), recebeu horário, não fechou.
  Eventos.registrar("contato", "+55190001", {}, t(0));
  Eventos.registrar("mensagem", "+55190001", { classe: "outro" }, t(0));      // "Bom dia"
  Eventos.registrar("mensagem", "+55190001", { classe: "agendar" }, t(1));
  Eventos.registrar("horarios_oferecidos", "+55190001", { quantidade: 2 }, t(2));
  Eventos.registrar("preco_informado", "+55190001", {}, t(3));

  // Uma que perguntou preço e sumiu.
  Eventos.registrar("contato", "+55190002", {}, t(0));
  Eventos.registrar("mensagem", "+55190002", { classe: "preco" }, t(0));
  Eventos.registrar("preco_informado", "+55190002", {}, t(1));

  // Uma de convênio: NUNCA foi lead particular.
  Eventos.registrar("contato", "+55190003", {}, t(0));
  Eventos.registrar("mensagem", "+55190003", { classe: "convenio" }, t(0));

  // Uma que fechou e pagou.
  Eventos.registrar("contato", "+55190004", {}, t(0));
  Eventos.registrar("mensagem", "+55190004", { classe: "sintoma" }, t(0));
  Eventos.registrar("agendou", "+55190004", { crianca: "Miguel" }, t(5));
  Eventos.registrar("pagou", "+55190004", {}, t(6));

  const f = Eventos.funil();
  const et = (chave) => f.etapas.find((e) => e.chave === chave).quantidade;

  eq(et("contatos"), 4, "6. quatro contatos, não quatorze eventos: o funil conta por telefone");
  eq(et("recebeuPreco"), 3, "6b. três souberam o valor (dois ouviram, um deduzido de ter agendado)");
  eq(et("recebeuHorario"), 2, "6c. dois receberam horário (um explícito, um deduzido do agendamento)");
  eq(et("agendou"), 1, "6d. um agendou");
  eq(et("pagou"), 1, "6e. e pagou");
}

// ------------------------------------------------- 7. o funil não pode alargar no meio
{
  // Quem pagou agendou; quem agendou recebeu horário; quem recebeu horário soube o valor
  // (a regra NUNCA CONFIRME SEM TER INFORMADO O VALOR garante). Sem essa normalização um
  // evento perdido faz a etapa de baixo ficar MAIOR que a de cima, o que é impossível de ler.
  const f = Eventos.funil();
  for (let i = 1; i < f.etapas.length; i++) {
    ok(f.etapas[i].quantidade <= f.etapas[i - 1].quantidade,
      `7. "${f.etapas[i].rotulo}" (${f.etapas[i].quantidade}) não pode ser maior que "${f.etapas[i - 1].rotulo}" (${f.etapas[i - 1].quantidade})`);
  }
}

// ------------------------------------------------- 8. o recorte que muda tudo
{
  const f = Eventos.funil();
  eq(f.porPergunta.preco.total, 1, "8. quem perguntou o valor é SEGMENTO, não etapa (senão o funil alarga)");
  eq(f.porPergunta.convenio.total, 1, "8b. o lead de convênio é contado à parte");
  eq(f.porPergunta.convenio.agendou, 0, "8c. e não fechou, como esperado");
  eq(f.conversaoParticular.base, 3, "8d. a base particular EXCLUI quem chegou por convênio");
  eq(f.conversaoParticular.fecharam, 1, "8e. um fechou");
  eq(f.conversaoParticular.taxa, 33, "8f. 33% e não 25%: é essa a diferença que a separação faz");
}

// ------------------------------------------------- 9. a maior queda aponta o gargalo
{
  const f = Eventos.funil();
  ok(f.maiorQueda && f.maiorQueda.perdeu > 0, "9. o funil aponta onde caiu mais gente");
  ok(typeof f.maiorQueda.de === "string" && typeof f.maiorQueda.para === "string",
    "9b. dizendo entre quais duas etapas");
}

// ------------------------------------------------- 10. "primeira pergunta" pula a saudação
{
  // Quase toda conversa abre com "bom dia", que não diz nada sobre o que a pessoa veio
  // buscar. Se o funil pegasse a PRIMEIRA mensagem, quase todo lead seria "outro".
  const katia = Eventos.funil().contatos.find((c) => c.telefone === "+55190001");
  eq(katia.primeiraPergunta, "agendar",
    "10. a primeira pergunta é a primeira que NÃO é saudação");
}

// ------------------------------------------------- 11. nunca derruba a resposta pra família
{
  ok(/try \{[\s\S]*fs\.appendFileSync[\s\S]*\} catch \(erro\) \{/.test(FONTE),
    "11. a gravação é envolvida em try/catch");
  ok(/console\.error\("\[EVENTOS\] Não consegui registrar:"/.test(FONTE),
    "11b. e o erro fica no log, senão some sem rastro");
  ok(!/await Eventos\.registrar\(/.test(SERVER), "11c. nunca é aguardada no server");
  ok(!/await Eventos\.registrar\(/.test(PAINEL), "11d. nem no painel");
}

// ------------------------------------------------- 12. os ganchos estão nos lugares certos
{
  ok(/if \(!jaTeveSessao\) Eventos\.registrar\("contato"/.test(SERVER),
    "12. o topo do funil só conta uma vez por número");
  ok(/const jaTeveSessao = !!Storage\.obterSessao\(telefone\);/.test(SERVER),
    "12b. lido ANTES de qualquer coisa criar sessão, senão nunca é a primeira vez");
  ok(/Eventos\.registrar\("mensagem", telefone, \{\s*\n\s*classe: Eventos\.classificar\(texto\)/.test(SERVER),
    "12c. toda mensagem é classificada");
  ok(/R\\\$\\s\?\(550\|800\)/.test(SERVER),
    "12d. o preço é detectado no TEXTO que sai, não numa flag que a IA precisa lembrar de mandar");
  ok(/Eventos\.registrar\("agendou"/.test(SERVER), "12e. agendamento");
  ok(/Eventos\.registrar\("escalou"/.test(SERVER), "12f. escalada");
  ok(/if \(ok && pago\) \{/.test(PAINEL), "12g. e o pagamento só conta quando é MARCADO, não desmarcado");
}

// ------------------------------------------------- 13. o funil fica DEPOIS das travas
{
  // Emergência, silêncio manual e comprovante não são etapa de funil comercial. Contar
  // aquelas mensagens inflaria o topo com quem já é paciente.
  const posEmergencia = SERVER.indexOf('CerebroIA.pareceEmergencia(texto)');
  const posFunil = SERVER.indexOf('Eventos.registrar("mensagem"');
  ok(posEmergencia > 0 && posFunil > posEmergencia,
    "13. o registro de mensagem vem depois da checagem de emergência");
}

console.log(`\nregistro-de-eventos: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
