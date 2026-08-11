/*
 * Bateria de quem a Carla diz que é.
 *
 * Até hoje ela abria com "Aqui é a Carla, secretária do Dr. Bruno Soares". Secretária é
 * gente, e não existe uma Carla de carne e osso. A secretária da clínica se chama Jéssica,
 * e não é do consultório do Dr. Bruno. Então a família conversava três dias com a Carla,
 * chegava lá, e encontrava outra pessoa.
 *
 * A regra que mandava assumir ser automática quando PERGUNTAVAM já existia e estava certa
 * (ninguém nunca mentiu quando questionado). O problema era a afirmação positiva antes: um
 * cargo humano dito na primeira linha, que a maioria nunca ia questionar.
 *
 * O QUE MUDA E O QUE NÃO MUDA. Declarar a natureza transforma o nome de mentira em rótulo:
 * "Carla" colado em "secretária" é uma afirmação sobre uma pessoa; colado em "atendimento
 * automático" é o nome do sistema, como Alexa. Por isso o nome fica, o tom fica, e o registro
 * de secretária de consultório particular (linha COMO VOCÊ FALA) fica também, DE PROPÓSITO:
 * aquilo é sobre como ela escreve, não sobre o que ela diz ser, e é o que a impede de ficar
 * robótica. Tem teste abaixo trancando isso, pra ninguém "consertar" depois por engano.
 *
 * E a escalada mudou junto. Não existe equipe: quem resolve o que ela não resolve é o Dr.
 * Bruno. Mas quem VOLTA com a resposta continua sendo ela, porque num consultório premium
 * o filtro é parte do produto e abrir canal direto com o médico não tem volta depois.
 *
 * Roda com:  node tests/quem-a-carla-diz-que-e.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const CEREBRO = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");

// Só o que a Carla lê, e são DOIS pedaços: o bloco estável e o bloco de contexto. A regra da
// primeira mensagem mora no segundo, porque depende de a família já ser conhecida ou não, e
// foi pra lá quando o prompt foi partido pro cache. Recortar só o estável deixaria justamente
// a apresentação de fora, que é o que esta bateria existe pra vigiar.
//
// Comentário de código não conta: ele explica o porquê pra quem mexe no arquivo, e várias
// dessas explicações precisam citar a palavra "secretária" pra fazer sentido.
const PROMPT = CEREBRO.slice(CEREBRO.indexOf("const PROMPT_ESTAVEL = `"), CEREBRO.indexOf("function montarSystemPrompt("));
const SEM_COMENTARIO = PROMPT.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// ------------------------------------------------- 1. ela não afirma mais ser secretária
{
  ok(!/Aqui é a Carla, secretária/.test(SEM_COMENTARIO), "1. a apresentação não pode mais dizer secretária");
  ok(!/^Você é Carla, secretária/m.test(SEM_COMENTARIO), "1b. a identidade no topo do prompt não pode dizer secretária");
  ok(/NUNCA diz que é uma pessoa/.test(SEM_COMENTARIO), "1c. a proibição de dizer que é pessoa está no topo, onde ancora o resto");
  ok(/NUNCA se apresenta como secretária/.test(SEM_COMENTARIO), "1d. e a proibição de se apresentar como secretária também");
}

// ------------------------------------------------- 2. o registro de secretária FICA
{
  // Esta é a única "secretária" que sobra, e ela é sobre COMO ESCREVER, não sobre o que ela
  // é. Sem ela a Carla vira chatbot: é a linha que a segura longe de gíria e de frieza. Se
  // alguém apagar isso achando que está limpando resíduo, o tom desmonta.
  ok(/o registro é o de uma secretária de consultório particular/.test(SEM_COMENTARIO),
    "2. a linha de REGISTRO tem que continuar existindo: ela é sobre o tom, não sobre a identidade");
  // Duas, e as duas são legítimas: a do registro (como escrever) e a proibição no topo
  // (não se apresentar assim). Qualquer terceira é uma afirmação voltando.
  const ocorrencias = (SEM_COMENTARIO.match(/secretári/g) || []).length;
  eq(ocorrencias, 2, "2b. 'secretária' só pode aparecer duas vezes: o registro e a proibição");
  ok(/NUNCA se apresenta como secretária/.test(SEM_COMENTARIO), "2c. a segunda é a proibição, não uma afirmação");
}

// ------------------------------------------------- 3. a apresentação nova, inteira
{
  ok(/Aqui é a Carla, o atendimento automático do consultório do Dr\. Bruno Soares, pediatra/.test(SEM_COMENTARIO),
    "3. a apresentação diz o que ela é");
  ok(/Consigo ver valor, horário e marcar a consulta por aqui/.test(SEM_COMENTARIO),
    "3b. diz o que ela resolve, e inclui MARCAR (que é o que fecha consulta, não só informar)");
  ok(/o que eu não resolver eu levo pro Dr\. Bruno/.test(SEM_COMENTARIO),
    "3c. diz que existe um humano atrás. É a frase mais importante logo depois de assumir que é automática");
  ok(/Isso é dito UMA VEZ/.test(SEM_COMENTARIO),
    "3d. uma vez só: repetir que é automática em toda mensagem seria frio e ninguém pediu isso");
}

// ------------------------------------------------- 4. quem já perguntou não leva lista
{
  // Dois dos três últimos contatos reais chegaram com pergunta pronta (o Sávio perguntou de
  // convênio, o Almir mandou três perguntas). Pra esses, listar o que ela faz é barreira
  // entre a pergunta e a resposta.
  ok(/NESSE CASO a parte 2 fica só em quem você é/.test(SEM_COMENTARIO),
    "4. quem chegou perguntando recebe a apresentação sem a lista do que ela resolve");
  ok(/sem a lista do que você resolve/.test(SEM_COMENTARIO), "4b. a regra diz explicitamente pra cortar a lista");
}

// ------------------------------------------------- 5. a "equipe" sumiu do que a família lê
{
  // Não existe equipe. Quem resolve o que a Carla não resolve é o Dr. Bruno. Prometer
  // "alguém da equipe" é inventar gente, que é exatamente o defeito que esta mudança conserta.
  ok(!/alguém da equipe/.test(SEM_COMENTARIO), "5. nenhuma promessa de 'alguém da equipe' pode sobrar");
  ok(!/pra equipe e já te retornam/.test(SEM_COMENTARIO), "5b. nem a variação com 'equipe'");
  ok(!/sinaliza pra equipe continuar/.test(SEM_COMENTARIO), "5c. nem no fim de semana");
  ok(/NÃO fale em "equipe"/.test(SEM_COMENTARIO), "5d. e a regra diz na cara pra não falar em equipe");
}

// ------------------------------------------------- 6. a escalada: ele decide, ela responde
{
  // A decisão de abrir canal direto com o médico foi discutida e recusada: num consultório
  // premium o filtro é parte do produto, e acesso concedido não volta atrás. Então a escalada
  // leva a DECISÃO pro Dr. Bruno e traz a resposta pela Carla.
  ok(/vou confirmar isso com o Dr\. Bruno e já te retorno por aqui/.test(SEM_COMENTARIO),
    "6. a escalada promete que ELA retorna");
  ok(/Quem decide é ele; quem volta com a resposta é você/.test(SEM_COMENTARIO),
    "6b. a divisão está escrita, não subentendida");
  ok(/NÃO prometa que ele vai falar com a família/.test(SEM_COMENTARIO),
    "6c. e proíbe prometer conversa direta com o médico, que é o que criaria o gargalo");
  // Contar "transferir" não serve: a palavra aparece legitimamente na regra do Pix ("pra quem
  // vai transferir não ter que rolar a conversa"), falando da família mandando dinheiro. Quem
  // só existe dentro da proibição é "atendimento humano", então a trava vai nela.
  eq((SEM_COMENTARIO.match(/atendimento humano/g) || []).length, 1,
    "6d. 'atendimento humano' só aparece dentro da regra que bane a expressão");
  ok(/NUNCA use as palavras "transferir" ou "atendimento humano"/.test(SEM_COMENTARIO),
    "6e. a proibição das palavras burocráticas continua de pé");
}

// ------------------------------------------------- 7. se perguntarem, ela confirma sem recitar
{
  ok(/você já disse isso na primeira mensagem desta conversa, então não recite tudo de novo/.test(SEM_COMENTARIO),
    "7. perguntada de novo, ela confirma em vez de repetir a apresentação inteira");
  ok(/Sou o atendimento automático do consultório do Dr\. Bruno/.test(SEM_COMENTARIO),
    "7b. e a resposta continua sendo a mesma palavra da abertura, pro sistema falar uma coisa só");
  ok(/nunca peça desculpas por ser automática/.test(SEM_COMENTARIO),
    "7c. sem pedido de desculpa: assumir com naturalidade era o certo antes e continua sendo");
}

// ------------------------------------------------- 8. o resto do desenho não foi mexido
{
  // Esta mudança é sobre quem ela DIZ que é. Nada do que ela FAZ podia mudar junto.
  ok(/Você não é médica/.test(SEM_COMENTARIO), "8. continua proibida de dar parecer clínico (agora dito pelo motivo certo)");
  ok(/NUNCA DESCARTE A CONSULTA/.test(SEM_COMENTARIO), "8b. a regra do TEA e do encaminhamento continua intacta");
  ok(/humana, educada, objetiva, acolhedora, natural, firme, premium/.test(SEM_COMENTARIO), "8c. o TOM não mudou");
  ok(/Consulta de segunda a sexta: R\$ 550/.test(SEM_COMENTARIO), "8d. o preço não mudou");
  ok(/A consulta fica em R\$ 800/.test(SEM_COMENTARIO), "8e. o valor de fim de semana não mudou");
  ok(/Chave Pix: brunofransoares@gmail\.com/.test(SEM_COMENTARIO), "8f. a chave Pix não mudou");
}

console.log(`\nquem-a-carla-diz-que-e: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
