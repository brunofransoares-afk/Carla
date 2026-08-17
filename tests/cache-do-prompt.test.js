/*
 * Bateria do cache do prompt.
 *
 * O prompt da Carla tem uns 50 KB e era mandado inteiro em TODA chamada da API, inclusive
 * nas até 4 voltas do laço de ferramentas de uma única mensagem. Agora ele vai partido em
 * dois: um bloco estável, marcado com cache_control, e um bloco de contexto no fim com o
 * que muda de conversa pra conversa.
 *
 * O cache da Anthropic é por PREFIXO, e falha CALADO: se um byte que muda voltar pro bloco
 * estável, a API não reclama, não dá erro, só passa a cobrar tudo de novo. Ninguém percebe
 * até a fatura chegar. É essa a trava central daqui: o bloco estável tem que sair byte a
 * byte igual em todas as combinações de flags e em qualquer horário.
 *
 * SOBRE A DIVISÃO NÃO TER PERDIDO NADA: a mudança foi um recorta-e-cola de 6 KB dentro de
 * um arquivo de 50 KB, então antes de commitar isso rodou uma comparação linha a linha
 * contra o prompt do commit anterior, nas 24 combinações de flags: nenhuma linha sumiu e
 * nenhuma linha nova entrou além dos três ponteiros. Essa comparação não ficou na bateria
 * de propósito: depois do commit ela compararia o arquivo com ele mesmo, passaria sempre e
 * não significaria mais nada. Pra refazer, é só apontar o teste pra `git show <sha>` do
 * commit anterior à divisão. O que ficou aqui é o que continua valendo pra sempre.
 *
 * Roda com:  node tests/cache-do-prompt.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const RAIZ = path.join(__dirname, "..");
const ATUAL = fs.readFileSync(path.join(RAIZ, "cerebro-ia.js"), "utf8");

// Não dá pra dar require em cerebro-ia.js aqui: ele puxa o SDK da Anthropic, que não está
// instalado na máquina onde os testes rodam. Então recorta só o pedaço que monta o prompt
// e avalia esse pedaço sozinho.
function extrairMontador(fonte) {
  const linhas = fonte.split(/\r?\n/);
  const inicio = linhas.findIndex((l) => /^const PROMPT_ESTAVEL = |^function montarSystemPrompt\(/.test(l));
  const daFuncao = linhas.findIndex((l) => /^function montarSystemPrompt\(/.test(l));
  if (inicio < 0 || daFuncao < 0) throw new Error("não achei montarSystemPrompt na fonte");
  let fim = -1;
  for (let i = daFuncao; i < linhas.length; i++) { if (linhas[i] === "}") { fim = i; break; } }
  if (fim < 0) throw new Error("não achei o fim de montarSystemPrompt");
  const trecho = linhas.slice(inicio, fim + 1).join("\n");
  return new Function(trecho + "\nreturn montarSystemPrompt;")();
}

// Os nomes dos dias vêm do config do app em produção, via global. Sem isso a data sai com
// o dia da semana vazio, o que não quebra nada aqui, mas deixa o teste menos parecido com
// o que roda de verdade.
global.CARLA_CONFIG = { nomesDiaSemana: ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"] };

const montarNovo = extrairMontador(ATUAL);

const AGORA = new Date(2026, 7, 5, 14, 30);
const CONSULTAS = [
  null,
  { crianca: "Eduardo", diaLabel: "quinta-feira (06/08) às 15:00", ehHoje: false },
  { crianca: "Isis", diaLabel: "hoje às 16:30", ehHoje: true },
];

// Todas as combinações das flags que mudam o prompt. São elas que a divisão precisa
// aguentar: cada uma tem que sair no bloco de contexto e nenhuma pode vazar pro estável.
const COMBINACOES = [];
for (const pac of [false, true])
  for (const portal of [false, true])
    for (const guia of [false, true])
      for (const consulta of CONSULTAS)
        COMBINACOES.push({ pac, portal, guia, consulta });

// ------------------------------------------------- 1. o bloco estável nunca muda
{
  const primeiro = montarNovo(AGORA, false, false, false, null).estavel;
  let todosIguais = true;
  for (const c of COMBINACOES) {
    if (montarNovo(AGORA, c.pac, c.portal, c.guia, c.consulta).estavel !== primeiro) todosIguais = false;
  }
  ok(todosIguais, "1. o bloco estável tem que ser byte a byte igual nas " + COMBINACOES.length + " combinações de flags");

  // A hora também não pode entrar. Duas horas diferentes, mesmo bloco estável.
  const outraHora = montarNovo(new Date(2026, 0, 2, 8, 5), false, false, false, null).estavel;
  ok(outraHora === primeiro, "1b. mudar a data e a hora de agora não pode mexer no bloco estável");
}

// ------------------------------------------------- 2. nada de interpolação no estável
{
  const estavel = montarNovo(AGORA, true, true, true, CONSULTAS[2]).estavel;
  ok(!estavel.includes("${"), "2. o bloco estável não pode ter interpolação nenhuma sobrando");
  // Sem \b depois de "é": em JS o \b só conta letra sem acento, então /\bHoje é\b/ NUNCA
  // casa e a trava passaria sempre, mesmo com a data de volta no lugar errado. Já passou.
  ok(!/^Hoje é /m.test(estavel), "2b. a data de hoje não pode estar no bloco estável");
  ok(!/PACIENTE JÁ CONHECIDO/.test(estavel), "2c. o aviso de paciente conhecido não pode estar no bloco estável");
  ok(!/CONSULTA JÁ MARCADA/.test(estavel), "2d. a consulta já marcada não pode estar no bloco estável");
  ok(!/JÁ ESTÁ LIBERADO|JÁ LIBEROU/.test(estavel), "2e. o estado do portal e do guia não pode estar no bloco estável");
}

// ------------------------------------------------- 3. os ponteiros continuam apontando
{
  // Nos três lugares de onde saiu texto ficou uma linha fixa mandando ler o fim do prompt.
  // Sem elas a Carla chega no meio de uma lista de regras e o assunto simplesmente some,
  // sem nem saber que existe continuação. Elas e o título da seção lá embaixo precisam
  // combinar: renomear a seção sem mexer nos ponteiros deixa a Carla procurando por uma
  // parte do prompt que não existe mais.
  const { estavel, volatil } = montarNovo(AGORA, false, false, false, null);
  const SECAO = "CONTEXTO DESTE ATENDIMENTO";

  ok(volatil.startsWith(SECAO), "3. o bloco de contexto abre com o título que os ponteiros citam");
  ok(/^A data e a hora de agora, .*CONTEXTO DESTE ATENDIMENTO/m.test(estavel), "3b. o ponteiro da data e do contexto da família está no lugar");
  ok(/^PRIMEIRA MENSAGEM: .*CONTEXTO DESTE ATENDIMENTO/m.test(estavel), "3c. o ponteiro da primeira mensagem está no lugar");
  ok(/^- Acesso ao portal e ao Guia Completo de Pediatria: .*CONTEXTO DESTE ATENDIMENTO/m.test(estavel), "3d. o ponteiro do portal e do guia está no lugar");
  eq((estavel.match(new RegExp(SECAO, "g")) || []).length, 3, "3e. são três ponteiros, um pra cada pedaço que saiu do meio do texto");
}

// ------------------------------------------------- 4. o contexto carrega o que mudou
{
  const semNada = montarNovo(AGORA, false, false, false, null).volatil;
  ok(/Hoje é quarta-feira, 05\/08\/2026, 14:30\./.test(semNada), "4. a data e a hora de agora saem no contexto");
  ok(/quem libera é o Dr\. Bruno/.test(semNada), "4b. sem portal liberado, o contexto traz a versão de não liberado");
  ok(/o Dr\. Bruno VENDE/.test(semNada), "4c. sem guia liberado, o contexto traz a versão de não liberado");

  const comTudo = montarNovo(AGORA, true, true, true, CONSULTAS[2]).volatil;
  ok(/PACIENTE JÁ CONHECIDO/.test(comTudo), "4d. paciente conhecido sai no contexto");
  ok(/CONSULTA JÁ MARCADA NESTE TELEFONE: Isis/.test(comTudo), "4e. a consulta já marcada sai no contexto, com o nome da criança");
  ok(/É HOJE/.test(comTudo), "4f. consulta de hoje sai marcada como hoje");
  ok(/Acesso ao portal: JÁ ESTÁ LIBERADO/.test(comTudo), "4g. portal liberado sai no contexto");
  ok(/o Dr\. Bruno JÁ LIBEROU/.test(comTudo), "4h. guia liberado sai no contexto");
}

// ------------------------------------------------- 5. a abertura muda com o paciente conhecido
{
  const novo = montarNovo(AGORA, false, false, false, null).volatil;
  const conhecido = montarNovo(AGORA, true, false, false, null).volatil;
  ok(/você não recita um texto pronto/.test(novo), "5. família nova recebe a estrutura de apresentação");
  ok(/NÃO use a apresentação padrão do consultório/.test(conhecido), "5b. família conhecida NÃO recebe a apresentação padrão");
  ok(!/NÃO use a apresentação padrão do consultório/.test(novo), "5c. a versão de conhecido não pode vazar pra família nova");
}

// ------------------------------------------------- 6. o estável é grande o bastante pra cachear
{
  const estavel = montarNovo(AGORA, false, false, false, null).estavel;
  // O mínimo do Sonnet 5 é 1024 tokens. Abaixo disso a API não cacheia e não avisa. Em
  // português dá uns 3,5 caracteres por token, então 1024 tokens são uns 3,5 mil
  // caracteres. O prompt tem uns 45 mil, folga de sobra, mas a trava fica aqui pro dia em
  // que alguém resolver encolher o prompt.
  ok(estavel.length > 10000, "6. o bloco estável precisa passar longe do mínimo cacheável do Sonnet 5 (tem " + estavel.length + " caracteres)");

  const volatil = montarNovo(AGORA, true, true, true, CONSULTAS[1]).volatil;
  ok(volatil.length < estavel.length / 4, "6b. o contexto é o pedaço pago inteiro toda vez, tem que ser bem menor que o estável (contexto " + volatil.length + ", estável " + estavel.length + ")");
}

// ------------------------------------------------- 7. a chamada da API marca o cache certo
{
  // Marcar o bloco errado é o jeito mais fácil de gastar mais em vez de menos: se a marca
  // for pro bloco volátil, toda chamada grava uma entrada nova de cache que ninguém lê.
  const chamada = ATUAL.slice(ATUAL.indexOf("async function chamarClaudeComFerramentas"));
  ok(/system\.estavel[^\n]*cache_control/.test(chamada), "7. o cache_control tem que estar no bloco estável");
  ok(!/system\.volatil[^\n]*cache_control/.test(chamada), "7b. o bloco volátil NÃO pode levar cache_control");
  ok(/ttl:\s*"1h"/.test(chamada), "7c. o cache é de 1 hora, não os 5 minutos padrão");
  eq((chamada.match(/cache_control/g) || []).length, 1, "7d. uma marca de cache só");
  ok(/system:\s*systemEmBlocos/.test(chamada), "7e. a chamada da API tem que mandar os dois blocos");
  ok(/registrarUsoDeCache\(resposta\.usage\)/.test(chamada), "7f. cada chamada registra no log quanto veio do cache");
}

// ------------------------------------------------- 8. o modelo não muda no meio
{
  // Cache é por modelo. Trocar o modelo joga fora tudo que estava guardado, então ele
  // precisa continuar sendo uma constante só, decidida uma vez.
  eq((ATUAL.match(/model:\s*MODELO/g) || []).length, 1, "8. só existe um lugar decidindo o modelo da chamada");
  ok(/^const MODELO = "[^"]+";$/m.test(ATUAL), "8b. o modelo é constante, não é montado em tempo de execução");
}

console.log(`\n${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
