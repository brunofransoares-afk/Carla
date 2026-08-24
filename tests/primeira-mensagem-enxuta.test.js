/*
 * Bateria da primeira mensagem enxuta.
 *
 * Contato real de 13/08, 15:18. O pai escreveu duas linhas: "Gostaria de saber o valor da
 * consulta com o Dr Bruno" e "Bebê 10 meses". Perguntou UMA coisa. Recebeu SEIS blocos:
 *
 *   1. saudação + "tudo ótimo, obrigada"
 *   2. quem a Carla é
 *   3. "Ele atende desde recém-nascidos, então já pode trazer o bebê para acompanhar o
 *      desenvolvimento com calma"
 *   4. duração 1h + avaliação completa + suporte 30 dias + espaço da criança no sistema
 *   5. particular + R$ 550 + formas de pagamento
 *   6. "Posso já ver um horário pra você?"
 *
 * NENHUMA REGRA ESTAVA ERRADA. Três dispararam juntas e nenhuma sabia das outras: a da
 * PRIMEIRA MENSAGEM (1 e 2), a REGRA SOBRE PREÇO (4 e 5) e o CONVITE PRA AGENDAR (6). É o
 * mesmo defeito de sempre: regra que diz o que fazer sem dizer quando não fazer.
 *
 * O BLOCO 3 É O PIOR, e não veio de regra nenhuma: ela improvisou a partir do FATO "atende
 * desde recém-nascidos até adolescentes" porque o pai disse a idade do bebê. Só que ele disse
 * a idade como CONTEXTO do preço, não perguntando se o Dr. Bruno atende essa idade. Ela
 * respondeu uma pergunta que ninguém fez, e ainda emendou convite pra trazer a criança — numa
 * mensagem em que ele ainda não sabia quanto custava. Isso soa vendedor.
 *
 * A proibição de faixa etária na abertura JÁ EXISTIA, mas só no galho da abertura pura. Quem
 * chega perguntando cai no galho de baixo, onde ela não era repetida. Buraco de escopo.
 *
 * Roda com:  node tests/primeira-mensagem-enxuta.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }

const CEREBRO = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
const PROMPT = CEREBRO.slice(CEREBRO.indexOf("const PROMPT_ESTAVEL = `"), CEREBRO.indexOf("function montarSystemPrompt("));
const SEM_COMENTARIO = PROMPT.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// ------------------------------------------------- 1. o buraco de escopo foi fechado
{
  ok(/E RESPONDA SÓ O QUE ELA PERGUNTOU/.test(SEM_COMENTARIO),
    "1. a regra existe, e no galho de quem já chegou perguntando");
  ok(/nada de faixa etária, currículo do Dr\. Bruno ou qualquer informação que ninguém pediu/.test(SEM_COMENTARIO),
    "1b. e nomeia o que não entra, porque proibição genérica ela não obedece");

  // A proibição antiga continua onde sempre esteve (abertura pura). As duas precisam existir:
  // apagar a de cima achando que a nova cobre tudo devolve o defeito pro outro galho.
  ok(/não despeje preço, duração da consulta, faixa etária, aviso de particular ou currículo aqui/.test(SEM_COMENTARIO),
    "1c. a proibição original da abertura pura continua de pé");
}

// ------------------------------------------------- 2. idade da criança é contexto, não pergunta
{
  // Este é o caso concreto que gerou o print. Sem o exemplo escrito ela não separa as duas
  // coisas: "bebê 10 meses" e "atende bebê de 10 meses?" chegam parecidos.
  ok(/bebê de 10 meses" logo depois de perguntar o valor está dizendo DE QUEM é a consulta/.test(SEM_COMENTARIO),
    "2. o exemplo real está escrito, com a leitura certa do que a família quis dizer");
  ok(/não perguntando se o Dr\. Bruno atende essa idade/.test(SEM_COMENTARIO),
    "2b. e diz na cara o que NÃO é");
  ok(/Não responda pergunta que não foi feita/.test(SEM_COMENTARIO), "2c. com a regra geral por trás do exemplo");
}

// ------------------------------------------------- 3. nada de convidar a trazer a criança
{
  // "então já pode trazer o bebê para acompanhar o desenvolvimento com calma" veio ANTES do
  // preço. Empurrar consulta pra quem ainda não sabe quanto custa é o oposto de premium.
  ok(/nunca emende convite pra trazer a criança/.test(SEM_COMENTARIO), "3. o convite pra trazer está proibido aqui");
  ok(/já pode trazer/.test(SEM_COMENTARIO), "3b. citando a frase que saiu de verdade");
  ok(/isso soa vendedor numa mensagem em que ela ainda nem ouviu o preço/.test(SEM_COMENTARIO),
    "3c. com o motivo, que é o que faz a regra pegar em vez de virar lista de frases banidas");
}

// ------------------------------------------------- 4. o preço na abertura vem cortado
{
  ok(/O PREÇO NA PRIMEIRA MENSAGEM DA CONVERSA É MAIS CURTO:/.test(SEM_COMENTARIO),
    "4. a regra do preço agora sabe que existe um caso em que ela é curta");
  ok(/O espaço da criança no sistema NÃO entra aqui/.test(SEM_COMENTARIO),
    "4b. e o que sai é o portal, que é o quarto assunto de uma mensagem que já tem três");
  ok(/quem perguntou "quanto custa" não veio fazer tour do consultório/.test(SEM_COMENTARIO),
    "4c. com o motivo escrito");
  ok(/individualizada\. Depois, a família continua com suporte por WhatsApp durante 30 dias\." seguido de "O atendimento é particular, e o valor é R\$ 550/.test(SEM_COMENTARIO),
    "4d. e um exemplo do tamanho certo, senão 'curta' cada dia quer dizer uma coisa");
}

// ------------------------------------------------- 5. o corte é SÓ na abertura
{
  // O portal é bom e foi construído pra ser mostrado. Ele não podia sumir da conversa, só
  // sair da mensagem mais cheia dela.
  ok(/Isso vale só na primeira mensagem: perguntou o preço no meio da conversa, use a descrição inteira/.test(SEM_COMENTARIO),
    "5. o escopo está escrito, senão ela corta o portal pra sempre");
  ok(/tem um espaço só da criança no sistema, onde guarda os exames e a carteira de vacinação/.test(SEM_COMENTARIO),
    "5b. a descrição completa continua existindo pro caso normal");
  ok(/Ele entra depois, se a conversa seguir e o assunto encaixar \(rotina, vacina, recém-nascido\)/.test(SEM_COMENTARIO),
    "5c. e diz quando ele volta, em vez de só mandar tirar");
}

// ------------------------------------------------- 6. o resto da abertura não mudou
{
  // Esta mudança é sobre QUANTO ela fala na primeira mensagem. Nada do que ela faz podia
  // mudar junto.
  ok(/Aqui é a Carla, o atendimento automático do consultório do Dr\. Bruno Soares, pediatra/.test(SEM_COMENTARIO),
    "6. a apresentação continua a mesma");
  ok(/NESSE CASO a parte 2 fica só em quem você é/.test(SEM_COMENTARIO),
    "6b. quem chegou perguntando continua sem a lista do que ela resolve");
  ok(/nunca responda só "O valor é R\$ 550\." secamente/.test(SEM_COMENTARIO),
    "6c. e o valor continua proibido de sair seco: enxugar não é voltar a ser frio");
  ok(/CONVITE PRA AGENDAR: a mensagem em que você informa o VALOR da consulta SEMPRE termina puxando pro próximo passo/.test(SEM_COMENTARIO),
    "6d. o convite depois do valor continua, porque é o que fecha consulta");
}

console.log(`\nprimeira-mensagem-enxuta: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
