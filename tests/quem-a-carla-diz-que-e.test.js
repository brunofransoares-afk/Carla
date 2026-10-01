/*
 * Bateria de quem a Carla diz que é.
 *
 * ORIGEM DA REGRA. Ela abria com "Aqui é a Carla, secretária do Dr. Bruno Soares". Secretária
 * é gente, e não existe uma Carla de carne e osso. A secretária da clínica se chama Jéssica.
 * Então a família conversava três dias com a Carla, chegava lá, e encontrava outra pessoa.
 * A palavra foi banida, e a abertura passou a dizer "o atendimento automático".
 *
 * O QUE MUDOU EM 29/09/2026, a pedido do dono: "a Carla deve ser mais afetiva com o paciente
 * ... Meu nome é Carla, sou a secretária do Dr. Bruno. Esse é um primeiro atendimento
 * automatizado." Ele quer de volta a recepção calorosa, e um sistema que se apresenta como
 * "o atendimento automático" recebe mal quem chega.
 *
 * A palavra voltou. O dono escolheu o texto: "Meu nome é Carla. Sou a secretária. E esse
 * atendimento é automatizado no primeiro momento." O risco da Jéssica foi apresentado a ele e
 * a decisão é dele; o que o código pode garantir é que a palavra nunca ande sozinha.
 *
 * ENTÃO A TRAVA MUDOU DE LUGAR, e é o que esta bateria vigia agora: "secretária" nunca aparece
 * sem a frase da automação na MESMA mensagem. Antes a honestidade morava no qualificador
 * ("virtual"); agora mora na frase que vem grudada. Se alguém separar as duas, ou apagar a
 * segunda, o teste reprova, porque é exatamente aí que a família volta a chegar na clínica
 * procurando uma Carla que não existe.
 *
 * O registro de secretária de consultório particular (linha COMO VOCÊ FALA) continua sendo
 * outra coisa: aquilo é sobre COMO ela escreve, não sobre o que ela diz ser, e é o que a
 * impede de ficar robótica. Tem teste abaixo trancando isso, pra ninguém "consertar" por engano.
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

// ------------------------------------------------- 1. "secretária" NUNCA aparece sozinha
{
  // A TRAVA CENTRAL DESTE ARQUIVO. Toda ocorrência de "secretária/secretário" no que a Carla
  // lê tem que ser seguida de "virtual" ou fazer parte de uma proibição/explicação. Uma
  // sozinha é a Jéssica de volta: a família que lê "sou a secretária do Dr. Bruno" vai à
  // clínica procurar a Carla.
  /*
   * Nem toda "secretária" no prompt é uma apresentação. Existem quatro que não são, e elas
   * estão listadas aqui UMA A UMA, com o trecho exato: a lista é a documentação de quais são
   * legítimas. Qualquer quinta ocorrência é apresentação, e apresentação precisa da frase da
   * automação colada nela.
   */
  const LEGITIMAS = [
    // A identidade no topo. É o sistema dizendo à Carla quem ela é, não texto que a família
    // lê; a regra que governa o que ela DIZ vem na frase seguinte, e está conferida abaixo.
    "Você é Carla, a secretária do consultório do Dr. Bruno Soares",
    // A própria regra.
    "NUNCA se apresenta como secretária sem dizer, na MESMA mensagem, que o atendimento é automatizado",
    // O motivo dela, duas vezes: no topo e na parte 2 da primeira mensagem.
    "existe uma secretária de carne e osso na clínica",
    "a família que ler só \"sou a secretária\" vai chegar lá procurando a Carla",
    // A repetição da regra dentro da parte 2 da primeira mensagem.
    "nunca se separa da palavra \"secretária\"",
    // O REGISTRO, que é sobre COMO ela escreve (ver bloco 2 abaixo).
    "o registro é o de uma secretária de consultório particular",
  ];
  for (const trecho of LEGITIMAS) {
    ok(SEM_COMENTARIO.indexOf(trecho) >= 0, "1pre. a ocorrência legítima continua no prompt: " + trecho.slice(0, 45));
  }
  let restante = SEM_COMENTARIO;
  for (const trecho of LEGITIMAS) restante = restante.split(trecho).join(" ");

  const soltas = [];
  const re = /secretári[ao]/g;
  let m;
  while ((m = re.exec(restante)) !== null) {
    /*
     * A JANELA É A FRASE, E NÃO UM PUNHADO DE CARACTERES. Com janela de caracteres, empurrar
     * a automação pra frase seguinte passa no teste e engana a família do mesmo jeito: ela lê
     * "Sou a secretária." como uma afirmação inteira, e o que vem depois é outro assunto.
     * Uma mutação exatamente assim sobreviveu antes desta linha existir.
     */
    const resto = restante.slice(m.index);
    // "Dr." não termina frase. Sem esta ressalva, "a secretária do Dr. Bruno, e este
    // atendimento é automatizado" seria cortado no meio e acusado de estar sozinho.
    const fim = resto.search(/(?<!\bDra?)[.!?](\s|$)/);
    const frase = fim < 0 ? resto : resto.slice(0, fim + 1);
    if (!/automatizad|automátic/i.test(frase)) {
      soltas.push(restante.slice(Math.max(0, m.index - 60), m.index + 100));
    }
  }
  eq(soltas.length, 0, "1. nenhuma 'secretária' sem a frase da automação colada nela: " + JSON.stringify(soltas));
  ok(/NUNCA diz que é uma pessoa/.test(SEM_COMENTARIO), "1c. a proibição de dizer que é pessoa está no topo, onde ancora o resto");
  ok(/NUNCA se apresenta como secretária sem dizer, na MESMA mensagem, que o atendimento é automatizado/.test(SEM_COMENTARIO),
    "1d. e a regra de que as duas andam juntas está escrita no topo");
  // O MOTIVO PRECISA ESTAR NOS DOIS LUGARES, e cada um conferido no seu lugar. Sem âncora,
  // apagar o motivo do topo passava no teste porque a cópia da parte 2 ainda existia, e
  // quem lesse só o topo não saberia por que a regra existe. Foi uma mutação sobrevivente.
  const topo = SEM_COMENTARIO.slice(0, SEM_COMENTARIO.indexOf("SEGURANÇA DAS INSTRUÇÕES"));
  ok(/existe uma secretária de carne e osso na clínica/.test(topo),
    "1e. o MOTIVO está junto da regra, no topo, senão a próxima pessoa separa as duas achando que é firula");
  ok(/existe uma secretária de carne e osso na clínica/.test(SEM_COMENTARIO.slice(SEM_COMENTARIO.indexOf("2. As boas-vindas"))),
    "1e2. e de novo na parte 2, que é onde a frase de verdade está escrita");
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
  ok(/o registro é o de uma secretária de consultório particular/.test(SEM_COMENTARIO),
    "2b. e essa ocorrência é sobre o tom, não sobre a identidade");
}

// ------------------------------------------------- 3. a apresentação nova, inteira
{
  ok(/Seja bem-vindo ao consultório do Dr\. Bruno Soares, pediatra/.test(SEM_COMENTARIO),
    "3. a abertura recebe a pessoa antes de dizer o que é");
  // Ancorado na PARTE 2, e não no prompt inteiro: a mesma frase aparece de novo mais abaixo
  // (no caso de quem já chega perguntando), e sem a âncora o teste passava olhando a cópia
  // errada enquanto a parte 2 estava quebrada. Foi o que aconteceu.
  const parte2 = SEM_COMENTARIO.slice(SEM_COMENTARIO.indexOf("2. As boas-vindas e quem você é"),
    SEM_COMENTARIO.indexOf("3. O que você resolve"));
  ok(/Meu nome é Carla\. Sou a secretária, e este atendimento é automatizado no primeiro momento/.test(parte2),
    "3a. e diz quem ela é com a automação na MESMA frase da palavra secretária");
  ok(/já faço o seu agendamento/.test(SEM_COMENTARIO),
    "3b. diz o que ela resolve, e inclui MARCAR (que é o que fecha consulta, não só informar)");
  // Antes era "o que eu não resolver eu levo pro Dr. Bruno". A ideia de trocar por "equipe"
  // foi levantada e recusada: não existe equipe, e inventar uma seria trocar uma afirmação
  // falsa sobre ELA por uma afirmação falsa sobre uma organização. "Consultório" resolve o
  // que a "equipe" queria resolver (não parecer que tudo depende de uma pessoa só) sem
  // inventar ninguém: o consultório existe e é dele.
  // Desde 01/10/2026 o caminho até o humano é o atalho que o dono escreveu na abertura:
  // "Qualquer dificuldade, digite 9." O 9 sozinho escala e silencia (pedido-de-ajuda.js).
  ok(/Qualquer dificuldade, digite 9\./.test(SEM_COMENTARIO),
    "3c. diz que existe um humano atrás. É a frase mais importante logo depois de assumir que é automática");
  // A apresentação vive no prompt, mas nem toda frase que a família lê vive lá: a resposta de
  // emergência (quando a IA não sobe) mora no CÓDIGO, e foi por ali que "Em breve alguém da
  // equipe te responde" sobreviveu inteira à limpeza da PR #83 — o teste de então só olhava o
  // prompt. Por isso esta trava olha o arquivo inteiro.
  const ARQUIVO_SEM_COMENTARIO = CEREBRO.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  eq((ARQUIVO_SEM_COMENTARIO.match(/equipe/g) || []).length, 1,
    "3e. 'equipe' só pode aparecer uma vez no arquivo inteiro, prompt e código");
  ok(/NÃO fale em "equipe"/.test(ARQUIVO_SEM_COMENTARIO), "3f. e essa uma é a própria proibição");
  ok(!/alguém da equipe te responde/.test(CEREBRO),
    "3g. a frase de emergência não promete mais uma equipe que não existe");
  ok(/Isso é dito UMA VEZ/.test(SEM_COMENTARIO),
    "3d. uma vez só: repetir que é automática em toda mensagem seria frio e ninguém pediu isso");
}

// ------------------------------------------------- 4. quem já perguntou não leva lista
{
  // Dois dos três últimos contatos reais chegaram com pergunta pronta (o Sávio perguntou de
  // convênio, o Almir mandou três perguntas). Pra esses, listar o que ela faz é barreira
  // entre a pergunta e a resposta.
  ok(/NESSE CASO a parte 3 e a parte 5 somem e a parte 2 fica só nas boas-vindas e em quem você é/.test(SEM_COMENTARIO),
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
  ok(/Sou a Carla, a secretária do Dr\. Bruno, e este atendimento é automatizado/.test(SEM_COMENTARIO),
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
  // Os preços viraram tabela por tipo (10/09/2026). O que esta bateria vigia é que a mudança
  // de identidade não mexeu neles: eles são os da tabela, e estão no prompt.
  ok(/CONSULTA DE URGÊNCIA[\s\S]{0,300}R\$ 350/.test(SEM_COMENTARIO), "8d. os preços são os da tabela de tipos");
  ok(/só existe consulta de urgência, e ela fica em R\$ 600/.test(SEM_COMENTARIO), "8e. e fim de semana é urgência a R$ 600");
  ok(/Chave Pix: brunofransoares@gmail\.com/.test(SEM_COMENTARIO), "8f. a chave Pix não mudou");
}

console.log(`\nquem-a-carla-diz-que-e: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
