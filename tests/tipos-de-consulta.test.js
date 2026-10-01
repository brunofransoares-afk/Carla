/*
 * Bateria dos três tipos de consulta.
 *
 * Decisão do Dr. Bruno (10/09/2026): urgência R$ 350 (R$ 600 no fim de semana, e é a única
 * que existe lá; nunca por vídeo), puericultura R$ 450, investigação/acompanhamento de
 * transtornos do neurodesenvolvimento e saúde mental R$ 550. Não existe retorno presencial:
 * existe acompanhamento de exames e WhatsApp por 30 dias. Não existe mais preço de irmãos.
 *
 * E A CONVERSA MUDA DE ORDEM: tipo, depois valor, depois período (manhã ou tarde; comercial
 * ou noite na tele), depois horário. A Carla PERGUNTA o tipo, em linguagem de gente, e a
 * mensagem do valor termina em "prefere de manhã ou à tarde?" em vez de "posso ver um
 * horário?".
 *
 * POR QUE NÃO ERA MUDANÇA DE PROMPT. O valor escrito é lido de volta (precoParticularInformado)
 * e conferido antes de reservar. Três tipos = a ferramenta precisa saber o tipo, e a tabela
 * precisa ser uma só. Quando a Carla lista os três preços na mesma mensagem, a leitura vê
 * mais de um valor e NÃO registra nada, de propósito: o preço só é registrado depois que a
 * família escolheu e ela disse UM valor.
 *
 * Roda com:  node tests/tipos-de-consulta.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const RAIZ = path.join(__dirname, "..");
const Preco = require(path.join(RAIZ, "preco-da-consulta.js"));
const LER = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8").replace(/\r\n/g, "\n");
const CEREBRO = LER("cerebro-ia.js"), SERVER = LER("server.js"), STORAGE = LER("storage-node.js");
const PROMPT = CEREBRO.slice(CEREBRO.indexOf("const PROMPT_ESTAVEL = `"), CEREBRO.indexOf("function montarSystemPrompt("));
const SEM_COMENTARIO = PROMPT.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

function extrairLeitorDePreco() {
  const a = SERVER.indexOf("function valorEscrito(");
  const b = SERVER.indexOf("function combinarEfeitos(");
  return new Function("Preco", SERVER.slice(a, b) + "\nreturn precoParticularInformado;")(Preco);
}
const lerPreco = extrairLeitorDePreco();

// ------------------------------------------------- 1. a máquina lê o valor de cada tipo
{
  eq(lerPreco("O atendimento é particular. A consulta de urgência é R$ 350, em Pix ou cartão."), 35000, "1. urgência");
  eq(lerPreco("O atendimento é particular. A consulta de puericultura é R$ 450, em Pix ou cartão."), 45000, "1b. puericultura");
  eq(lerPreco("O atendimento é particular. A consulta de investigação de neurodesenvolvimento é R$ 550."), 55000, "1c. neurodesenvolvimento");
  eq(lerPreco("O atendimento é particular. No fim de semana a urgência fica em R$ 600."), 60000, "1d. urgência de fim de semana");
  eq(lerPreco("O atendimento é particular. Urgência R$ 350, puericultura R$ 450, neurodesenvolvimento R$ 550."), null,
    "1e. os três preços na mesma mensagem NÃO registram nada: o preço só vale depois de a família escolher o tipo");
  eq(lerPreco("O atendimento é particular. R$ 800."), null, "1f. R$ 800 não existe mais e não é lido");
  eq(lerPreco("O atendimento é particular. R$ 1.000 pelos dois."), null, "1g. preço de grupo de irmãos não existe mais");
  eq(lerPreco("A consulta é R$ 450."), null, "1h. sem dizer que é particular, não registra (regra antiga, intacta)");
}

// ------------------------------------------------- 2. a ferramenta exige o tipo e confere o preço dele
{
  ok(/tipoConsulta: \{ type: "string", enum: \["urgencia", "puericultura", "tnd"\]/.test(CEREBRO), "2. confirmar_agendamento tem tipoConsulta com os três tipos");
  ok(/required: \["slotId", "slotLabel", "responsavel", "crianca", "tipoConsulta"\]/.test(CEREBRO), "2b. e ele é OBRIGATÓRIO: sem tipo não há preço");
  ok(!/criancasJuntas/.test(CEREBRO), "2c. criancasJuntas sumiu: não existe preço de grupo");
  ok(/const preco = Preco\.precoDaConsulta\(slotFinal, tipoConsulta\);/.test(CEREBRO), "2d. o preço da reserva é o do tipo");
  ok(/if \(!preco\.valido\) \{/.test(CEREBRO) && /Se for fim de semana, só consulta de urgência existe/.test(CEREBRO),
    "2e. tipo inválido ou puericultura/tnd no fim de semana: recusa e explica");
  ok(/if \(modalidade === "teleconsulta" && !Preco\.permiteTeleconsulta\(tipoConsulta\)\) \{/.test(CEREBRO),
    "2f. urgência por teleconsulta é recusada");
  ok(/queixa aguda precisa de exame presencial/.test(CEREBRO), "2g. com o motivo, e mandando oferecer presencial");
  ok(/EstadoAtendimento\.precoFoiInformado\(ctx\.estadoAtendimento, preco\.centavos\)/.test(CEREBRO), "2h. a guarda confere o valor DO TIPO");
  ok(/Se o tipo certo é \$\{outro\}, chame de novo com tipoConsulta="\$\{outro\}"/.test(CEREBRO),
    "2i. se ela informou o valor de outro tipo, a recusa diz qual tipo passar em vez de fazer a família ouvir o preço de novo");
}

// ------------------------------------------------- 3. o tipo fica na reserva e no título
{
  ok(/tipoConsulta = null \}\) \{/.test(STORAGE) && /tipoConsulta: tipoConsulta \|\| null,/.test(STORAGE), "3. a reserva guarda o tipo");
  ok(/Storage\.reservar\(\{[\s\S]{0,160}tipoConsulta,/.test(CEREBRO), "3b. e a ferramenta passa ele");
  ok(/const rotuloTipo = \{ urgencia: "Urgência", puericultura: "Puericultura", tnd: "TND" \}\[tipoConsulta\]/.test(CEREBRO),
    "3c. o título do evento na agenda diz o tipo, pra ele saber sem abrir");
  ok(/jaDela\.tipoConsulta \|\| "tnd"/.test(CEREBRO), "3d. reserva antiga, sem tipo, é lida como tnd (era o preço da época)");
  ok(!/valorAtualizado|restantesNoDia/.test(CEREBRO), "3e. o recálculo de irmãos no cancelamento sumiu");
}

// ------------------------------------------------- 4. urgente respeita o período
{
  ok(/const periodoPedido = \["manha", "tarde", "comercial", "noite"\]\.includes\(input\.periodo\)/.test(CEREBRO), "4. o período pedido é lido no começo da busca");
  ok(/\.filter\(\(c\) => !periodoPedido \|\| Ordem\.bate\(c, \{ periodo: periodoPedido \}\)\)/.test(CEREBRO),
    "4b. e a busca urgente filtra por ele: urgência de manhã não pode voltar horário da tarde");
}

// ------------------------------------------------- 5. os FATOS
{
  ok(/TRÊS TIPOS DE CONSULTA, TRÊS VALORES/.test(SEM_COMENTARIO), "5. os três tipos estão nos FATOS");
  ok(/CONSULTA DE URGÊNCIA[\s\S]{0,120}R\$ 350/.test(SEM_COMENTARIO), "5b. urgência R$ 350");
  ok(/CONSULTA DE PUERICULTURA[\s\S]{0,160}R\$ 450/.test(SEM_COMENTARIO), "5c. puericultura R$ 450");
  ok(/CONSULTA DE INVESTIGAÇÃO OU ACOMPANHAMENTO DE NEURODESENVOLVIMENTO E SAÚDE MENTAL: R\$ 550/.test(SEM_COMENTARIO), "5d. neurodesenvolvimento R$ 550");

  /*
   * A FRONTEIRA ENTRE A 2 E A 3 (01/10/2026). O dono: "do jeito que tá a descrição das
   * consultas, dá a entender que a consulta de puericultura faz também o que a consulta de
   * neurodesenvolvimento faz. Não é que eu atendo só autista na consulta 3. Eu atendo crianças
   * que têm alguma suspeita de algum atraso. Ou de qualquer tipo."
   *
   * A 2 dizia "desenvolvimento normal" e a 3 dizia "(autismo, TDAH, TOD)". Lido de fora: a
   * rotina cobre desenvolvimento, e a 3 é só pra quem já tem diagnóstico. As duas leituras
   * mandam a criança com suspeita de atraso pra consulta errada.
   */
  ok(/a 2 é acompanhar a criança que está DENTRO do esperado, a 3 é investigar o que parece FORA dele/.test(SEM_COMENTARIO),
    "5e. a fronteira entre as duas está escrita, e não deduzida da lista de diagnósticos");
  ok(/NÃO é só pra criança já diagnosticada, e NÃO é só autismo/.test(SEM_COMENTARIO),
    "5e2. e a 3 não é a consulta do autismo: é a de qualquer suspeita");
  ok(/suspeita de atraso é 3 mesmo que ninguém tenha falado em autismo/.test(SEM_COMENTARIO),
    "5e3. dito também pelo lado que ela erra na prática");
  ok(/QUEIXA CRÔNICA É DELA: o que vem de longe \(alergia de sempre, intestino, peso, sono\) é puericultura; o que começou agora é urgência/.test(SEM_COMENTARIO),
    "5f. e a queixa crônica tem dono: separa a 2 da 1 pelo tempo, não pelo sintoma");

  // O sono aparece na 2 e na 3 de propósito (as duas coisas existem), então ele precisa estar
  // nomeado como caso de escalar. Sem isso é o relato que ela mais vai classificar errado.
  ok(/O SONO CAI NOS DOIS[\s\S]{0,260}dúvida escala/.test(SEM_COMENTARIO),
    "5g. o sono está marcado como dúvida, que é o que ele é");

  // E A MENSAGEM DO VALOR PRECISA DESCREVER AS DUAS SEPARADAS. Antes elas dividiam um texto
  // só ("Puericultura ou neurodesenvolvimento: ..."), e era exatamente ali que a diferença
  // entre as duas sumia: a família ouvia a mesma coisa escolhendo qualquer uma das duas.
  ok(/Puericultura: comece por "É a consulta de rotina da criança/.test(SEM_COMENTARIO),
    "5h. a puericultura tem a descrição dela na mensagem do valor");
  ok(/Neurodesenvolvimento: comece por "É a consulta de quando alguma coisa parece fora do esperado/.test(SEM_COMENTARIO),
    "5h2. e a 3 tem a dela, diferente: é no que elas diferem que a família se perde");
  ok(!/Puericultura ou neurodesenvolvimento: "/.test(SEM_COMENTARIO),
    "5h3. e o texto compartilhado que apagava a diferença saiu");
  // A duração passou a ser a única diferença no formato (01/10/2026: neuro 1 hora e meia).
  ok(/O formato, igual nas duas a não ser pela DURAÇÃO \(puericultura "1 hora", neurodesenvolvimento "1 hora e meia"\): "Tem duração média de 1 hora/.test(SEM_COMENTARIO),
    "5h4. o que é igual nas duas continua dito uma vez só, senão a mensagem dobra de tamanho");
  ok(/direcionada à queixa do momento: não vira consulta de puericultura nem investigação/.test(SEM_COMENTARIO), "5e. urgência não vira outra coisa");
  ok(/No fim de semana é a ÚNICA que existe, e custa R\$ 600/.test(SEM_COMENTARIO), "5f. fim de semana: só urgência, R$ 600");
  ok(/Não existe preço de irmãos: cada criança é uma consulta do seu tipo/.test(SEM_COMENTARIO), "5g. sem preço de irmãos");
  ok(!/valor único|R\$ 800|R\$ 500 cada|R\$ 1\.000/.test(SEM_COMENTARIO), "5h. e nada do preço antigo sobrou no que ela lê");
}

// ------------------------------------------------- 6. retorno e teleconsulta
{
  ok(/NÃO existe retorno presencial/.test(SEM_COMENTARIO), "6. retorno presencial não existe");
  ok(/acompanhamento dos resultados dos exames que porventura forem pedidos, enviados pelo WhatsApp, e o WhatsApp pra dúvidas durante 30 dias/.test(SEM_COMENTARIO),
    "6b. o que existe é exames por WhatsApp e 30 dias de dúvidas");

  /*
   * RETORNO GRATUITO NÃO EXISTE, E ISSO PRECISA ESTAR DITO, NÃO DEDUZIDO. A regra já dizia
   * que não há retorno presencial e que outra consulta é consulta nova. Faltava a resposta à
   * pergunta que a família realmente faz, que não é "existe retorno?" e sim "eu pago de
   * novo?". Sem a frase, ela dependia de a Carla inferir de "consulta nova", e inferência é
   * onde o modelo escorrega pra simpatia: "não se preocupe, a gente dá um jeito".
   *
   * O dono, em 29/09/2026: "eu tô falando de retorno gratuito".
   */
  ok(/NÃO EXISTE RETORNO GRATUITO, nem consulta de cortesia, nem desconto pra quem já veio/.test(SEM_COMENTARIO),
    "6b2. e está escrito que retorno gratuito não existe, com essas palavras");
  ok(/se a família perguntar se o retorno é cobrado, a resposta é sim/.test(SEM_COMENTARIO),
    "6b3. com a resposta pronta pra pergunta que a família faz de verdade");
  ok(/é uma consulta nova, do tipo que for, com o valor daquele tipo/.test(SEM_COMENTARIO),
    "6b4. e a consulta nova vem com o valor do tipo dela, não solta");
  ok(/continua com o WhatsApp dos 30 dias, e é ali que a dúvida daquela consulta é respondida sem custo/.test(SEM_COMENTARIO),
    "6b5. dizendo o que É de graça, senão a recusa fica seca e a família ouve só 'paga de novo'");
  ok(!/já está incluso no valor/.test(SEM_COMENTARIO), "6c. a frase antiga do retorno incluso sumiu");
  ok(/SÓ pra puericultura e pra investigação\/acompanhamento de neurodesenvolvimento\. Consulta de urgência não existe por vídeo/.test(SEM_COMENTARIO),
    "6d. tele: só puericultura e neurodesenvolvimento");
  ok(/Só fale sobre teleconsulta \(e a ressalva/.test(SEM_COMENTARIO), "6e. a regra de só falar de tele quando perguntarem continua");
}

// ------------------------------------------------- 7. a ordem da conversa
{
  ok(/COMO CONDUZIR: a ordem é TIPO, depois VALOR, depois PERÍODO, depois HORÁRIO/.test(SEM_COMENTARIO), "7. a ordem está escrita numa frase");
  // A pergunta virou menu numerado a pedido do Dr. Bruno (10/09); o detalhe do menu mora em
  // tests/jornada-da-familia.test.js. Aqui só importa que as três opções continuam lá.
  ok(/1\. Consulta de urgência\n/.test(SEM_COMENTARIO) && /2\. Consulta de puericultura\n/.test(SEM_COMENTARIO) && /3\. Consulta de neurodesenvolvimento e saúde mental\n/.test(SEM_COMENTARIO),
    "7b. a pergunta do tipo, com as três opções");
  ok(/SEM NENHUM valor nessa mensagem: primeiro o tipo fica claro, depois você direciona/.test(SEM_COMENTARIO), "7c. sem preço na pergunta do tipo");
  ok(/O TIPO NÃO MUDA DEPOIS DE ESCOLHIDO\./.test(SEM_COMENTARIO), "7d. na dúvida entre tipos, não escolhe: escala (ver caso-liso)");
  ok(/O VALOR VEM DEPOIS DO TIPO E ANTES DO PERÍODO, SEMPRE/.test(SEM_COMENTARIO), "7e. valor entre tipo e período");
  ok(/"Você prefere de manhã ou à tarde\?"/.test(SEM_COMENTARIO), "7f. a mensagem do valor termina em manhã ou tarde");
  ok(!/Posso já ver um horário pra você\?/.test(SEM_COMENTARIO), "7g. o 'posso ver um horário?' sumiu");
  ok(/AGENDAMENTO: depois do valor, você pergunta o PERÍODO[\s\S]{0,200}oferece os 2 horários reais que ela devolver, DAQUELE período/.test(SEM_COMENTARIO),
    "7h. e depois do período, 2 opções daquele período");
  ok(/Consulta de urgência: chame com urgente=true junto do período/.test(SEM_COMENTARIO), "7i. urgência usa urgente=true com o período");
  ok(/O nome do tipo vai junto do valor SEMPRE/.test(SEM_COMENTARIO), "7j. o nome do tipo vai junto do valor");
  ok(/Urgência: NÃO diga duração\. Diga que é direcionada à queixa do momento/.test(SEM_COMENTARIO), "7k. urgência sem duração, direcionada à queixa");
}

// ------------------------------------------------- 8. irmãos: seguidos sim, desconto não
{
  ok(/HORÁRIOS SEGUIDOS SÃO O PADRÃO/.test(SEM_COMENTARIO), "8. horários seguidos continuam sendo o padrão pra irmãos");
  ok(/CADA CRIANÇA É UMA CONSULTA DO SEU PRÓPRIO TIPO, com o seu próprio valor/.test(SEM_COMENTARIO), "8b. cada criança com o seu tipo e valor");
  ok(/Não existe desconto nem preço de grupo pra irmãos/.test(SEM_COMENTARIO), "8c. e sem desconto");
  ok(/trocar o tipo da consulta pra baratear/.test(SEM_COMENTARIO), "8d. a lista de NUNCA proíbe baratear trocando o tipo");
  ok(/você não troca o tipo pra baratear/.test(SEM_COMENTARIO), "8e. e 'não consegue pagar' também");
}

// ------------------------------------------------- 10. parcelamento: só a de R$ 550
{
  // Dito pelo Dr. Bruno em 10/09: ele só divide em 3x a consulta de R$ 550, e só se
  // perguntarem. Puericultura e urgência continuam por link de cartão, mas à vista; se a
  // família parcelar no cartão dela mesmo assim, as taxas são dela.
  ok(/PARCELAMENTO: só a consulta de neurodesenvolvimento \(R\$ 550\) pode ser dividida, em até 3x sem juros no cartão, e só se a família perguntar/.test(SEM_COMENTARIO), "10. a regra está escrita, com o valor e a condição");
  ok(/Puericultura \(R\$ 450\) e urgência \(R\$ 350 ou R\$ 600\) são à vista/.test(SEM_COMENTARIO), "10b. e diz quais são à vista");
  ok(/as taxas do parcelamento ficam por conta dela/.test(SEM_COMENTARIO), "10c. com a regra de quem paga a taxa se a família parcelar mesmo assim");
  ok(/Nunca diga "em até 3x" pra consulta de R\$ 350, R\$ 450 ou R\$ 600/.test(SEM_COMENTARIO), "10d. e a proibição na cara");
  ok(!/Pix ou cartão de crédito em até 3x/.test(SEM_COMENTARIO), "10e. o FATO de pagamento não promete mais 3x pra todo mundo");
  ok(/Se preferir cartão, me avisa que te mando o link\."/.test(SEM_COMENTARIO) && !/Se preferir cartão em até 3x/.test(SEM_COMENTARIO), "10f. a mensagem de Pix não fala mais em 3x");
  ok(/e só se for a consulta de neurodesenvolvimento \(R\$ 550\), você pode mencionar por conta própria que dá pra dividir/.test(SEM_COMENTARIO), "10g. quem não consegue pagar só ouve do parcelamento se for a de R$ 550");
  ok(/formasPagamento\.parcelamento/.test(SEM_COMENTARIO), "10h. e a ferramenta é a fonte do caso daquela reserva");
}

console.log(`\ntipos-de-consulta: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
