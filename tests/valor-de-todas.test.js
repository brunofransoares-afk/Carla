/**
 * 11/09: a família perguntou "Quero saber o valor de todas" e a Carla respondeu "Entendo a
 * curiosidade 😊 Mas o valor de cada uma é diferente, então preciso saber qual delas você
 * está procurando pra te passar certinho. Pode me responder só com o número, 1, 2 ou 3?".
 * Ela negou uma informação simples que a família pediu, repetiu a pergunta que a pessoa
 * acabou de recusar, e falou como quem está sendo paciente. Quem pede o valor dos três
 * recebe os três.
 *
 * O que esta bateria garante: a regra existe e está escrita sem ironia; os valores da lista
 * são os mesmos da TABELA de preços (a lista não pode envelhecer sozinha se o preço mudar);
 * e a trava de máquina continua valendo, isto é, a mensagem com os três valores NÃO registra
 * preço nenhum, então o tipo da conversa não trava no primeiro número que aparecer.
 */
"use strict";
const fs = require("fs");
const path = require("path");
let passou = 0, falhou = 0; const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const Preco = require(path.join(__dirname, "..", "preco-da-consulta.js"));
const CEREBRO = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const ESTAVEL = CEREBRO.slice(CEREBRO.indexOf("const PROMPT_ESTAVEL = `"), CEREBRO.indexOf("function montarContextoDoAtendimento("));
const REGRA = ESTAVEL.slice(ESTAVEL.indexOf("QUANDO A FAMÍLIA PEDIR O VALOR DE TODAS"), ESTAVEL.indexOf("O PREÇO NA PRIMEIRA MENSAGEM DA CONVERSA"));

// ------------------------------------------------- 1. a regra existe e responde de verdade
{
  ok(REGRA.length > 200, "1. a regra do valor de todas está no prompt estável");
  ok(/você informa os três, na mesma hora/.test(REGRA), "1b. e manda informar, não desconversar");
  ok(/tem direito à resposta/.test(REGRA) && /segurar o valor pra forçar a escolha do tipo é o contrário de atender/.test(REGRA), "1c. dizendo por quê, pra regra não virar letra morta");
  ok(/"quero saber o valor de todas"/.test(REGRA) && /"quanto custa cada uma\?"/.test(REGRA) && /"e as outras\?"/.test(REGRA), "1d. com os jeitos de perguntar que aparecem de verdade");
  ok(/Se ela pedir o valor de dois tipos, mesma coisa, com os dois\./.test(REGRA), "1e. dois tipos também");
}

// ------------------------------------------------- 2. sem ironia, sem repetir a pergunta recusada
{
  for (const frase of ["Entendo a curiosidade", "Entendo, mas...", "como eu te disse", "preciso que você me diga", "pra te passar certinho"]) {
    ok(REGRA.includes(`"${frase}"`), `2. "${frase}" está proibida por escrito (foi o que ela disse)`);
  }
  ok(/NUNCA responda com ironia, nem com jeito de quem está sendo paciente com ela/.test(REGRA), "2b. e a proibição é do tom, não só das frases");
  ok(/Nunca repita a mesma pergunta que ela acabou de recusar a responder\./.test(REGRA), "2c. e não repete a pergunta que a pessoa acabou de recusar");
}

// ------------------------------------------------- 3. os valores da lista são os da tabela
{
  const linha = (rotulo) => new RegExp(`^${rotulo}: (R\\$ [\\d.]+)$`, "m").exec(REGRA);
  const esperado = (tipo) => Preco.reais(Preco.TIPOS[tipo].centavos).replace(",00", "");
  for (const [rotulo, tipo] of [["Urgência", "urgencia"], ["Puericultura", "puericultura"], ["Neurodesenvolvimento e saúde mental", "tnd"]]) {
    const achado = linha(rotulo);
    ok(!!achado, `3. a lista tem a linha de ${rotulo}`);
    if (achado) eq(achado[1], esperado(tipo), `3b. e o valor de ${rotulo} é o da tabela de preços`);
  }
  const fds = Preco.reais(Preco.TIPOS.urgencia.fimDeSemanaCentavos).replace(",00", "");
  ok(REGRA.includes(`a linha da urgência é ${fds} e é a única que existe`), "3c. e o fim de semana usa o valor de fim de semana da tabela");
  ok(/Todas em Pix ou cartão via link de pagamento\./.test(REGRA), "3d. com a forma de pagamento numa frase só");
  ok(/Qual delas você está procurando\? Pode responder só com o número\."\n/.test(REGRA), "3e. e termina puxando a escolha do tipo, igual ao menu");
}

// ------------------------------------------------- 4. a máquina: vários valores não travam o tipo
{
  // A função do bot que decide se uma resposta REGISTRA o preço da conversa, executada.
  const fonte = SERVER.slice(SERVER.indexOf("function valorEscrito("), SERVER.indexOf("function combinarEfeitos("));
  const registra = new Function("Preco", fonte + "\nreturn precoParticularInformado;")(Preco);

  const lista = `O atendimento é particular 😊\n\nUrgência: R$ 350\nPuericultura: R$ 450\nNeurodesenvolvimento e saúde mental: R$ 550\n\nTodas em Pix ou cartão via link de pagamento. Qual delas você está procurando? Pode responder só com o número.`;
  eq(registra(lista), null, "4. a mensagem com os três valores não registra preço nenhum: o tipo da conversa não trava no primeiro número");
  eq(registra(`O atendimento é particular 😊\n\nUrgência: R$ 600\nPuericultura: R$ 450\n`), null, "4b. nem a de dois valores");

  const so450 = "O atendimento é particular. A consulta de puericultura é R$ 450, em Pix ou cartão via link de pagamento.";
  eq(registra(so450), Preco.TIPOS.puericultura.centavos, "4c. e a mensagem do tipo escolhido, com UM valor, registra e trava normalmente");
  eq(Preco.tipoDoValor(registra(so450)), "puericultura", "4d. no tipo certo");
  eq(registra("A consulta de puericultura é R$ 450, em Pix ou cartão."), null, "4e. um valor sozinho, sem a frase do atendimento ser particular, continua não registrando: a trava é a frase mais o valor único");
}

// ------------------------------------------------- 5. a lista não vira atalho pro agendamento
{
  ok(/Ela NÃO substitui a mensagem do valor/.test(REGRA) && /o valor dele sozinho \(REGRA SOBRE PREÇO\)/.test(REGRA), "5. depois da lista, a mensagem do valor daquele tipo continua existindo");
  ok(/a ferramenta continua recusando a reserva enquanto o valor daquele tipo não tiver sido dito sozinho/.test(REGRA), "5b. e o prompt diz que a máquina cobra isso, que é o que acontece de verdade (seção 4)");
  ok(/Esta é a ÚNICA mensagem em que mais de um valor aparece junto/.test(REGRA), "5c. e a lista não vale pra quem não pediu os três");
}

console.log(`\nvalor-de-todas: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
