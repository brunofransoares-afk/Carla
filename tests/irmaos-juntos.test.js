/*
 * Bateria do preço de irmãos agendados juntos.
 *
 * Print de 09/09, 09:06: "Gostaria de saber o valor da consulta e se teria um desconto para
 * 2 irmãos?". A Carla respondeu "Não trabalhamos com desconto, mesmo para irmãos" e a
 * conversa morreu ali. Eram duas consultas na mesma manhã.
 *
 * A REGRA (do Dr. Bruno): uma criança R$ 550; duas ou mais crianças da mesma família,
 * marcadas juntas no mesmo dia, R$ 500 CADA (2 = R$ 1.000, 3 = R$ 1.500), num pagamento só.
 * Cancelou um irmão, o que sobrou volta a R$ 550. Horários seguidos viram o padrão.
 *
 * POR QUE NÃO ERA MUDANÇA DE PROMPT. O preço virou máquina: o texto que a Carla escreve é
 * lido de volta (precoParticularInformado), o valor é gravado no estado, e confirmar_agendamento
 * só reserva se o valor do slot bater EXATAMENTE com o informado. Essa leitura só conhecia
 * 550 e 800 e devolvia null quando a mensagem citava dois valores, e a mensagem de irmãos
 * cita dois por natureza ("R$ 500 cada, R$ 1.000 pelas duas"). Um prompt dizendo "R$ 1.000"
 * com a máquina calculando 2 x R$ 550 travaria a Carla em loop, sem marcar nenhuma das duas.
 *
 * E o prompt afirmava em QUATRO lugares que desconto não existe. Uma quinta regra dizendo o
 * contrário seria o padrão que fez ela se contradizer cinco vezes com a Kátia. As quatro
 * foram escopadas, não apagadas.
 *
 * Roda com:  node tests/irmaos-juntos.test.js
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
const Link = require(path.join(RAIZ, "link-de-pagamento.js"));
const CEREBRO = fs.readFileSync(path.join(RAIZ, "cerebro-ia.js"), "utf8");
const SERVER = fs.readFileSync(path.join(RAIZ, "server.js"), "utf8");
const PROMPT = CEREBRO.slice(CEREBRO.indexOf("const PROMPT_ESTAVEL = `"), CEREBRO.indexOf("function montarSystemPrompt("));
const SEM_COMENTARIO = PROMPT.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// precoParticularInformado mora no server.js, que puxa o WhatsApp inteiro. Recorta só a
// função (e a auxiliar) e avalia sozinha, do mesmo jeito que a bateria do cache faz.
function extrairLeitorDePreco() {
  const a = SERVER.indexOf("function valorEscrito(");
  const b = SERVER.indexOf("function combinarEfeitos(");
  if (a < 0 || b < a) throw new Error("não achei precoParticularInformado no server.js");
  return new Function("Preco", SERVER.slice(a, b) + "\nreturn precoParticularInformado;")(Preco);
}
const lerPreco = extrairLeitorDePreco();

const SEGUNDA = { date: "2026-09-14" };
const SABADO = { date: "2026-09-12" };

// ------------------------------------------------- 1. a tabela, com os números do Dr. Bruno
{
  eq(Preco.precoDoGrupo(SEGUNDA, 1).centavos, 55000, "1. uma criança: R$ 550");
  eq(Preco.precoDoGrupo(SEGUNDA, 2).centavos, 100000, "1b. duas: R$ 1.000");
  eq(Preco.precoDoGrupo(SEGUNDA, 3).centavos, 150000, "1c. três: R$ 1.500");
  eq(Preco.precoDoGrupo(SEGUNDA, 2).porCrianca, "R$ 500,00", "1d. R$ 500 cada quando são duas");
  eq(Preco.precoDoGrupo(SEGUNDA, 2).reais, "R$ 1.000,00", "1e. escrito com ponto de milhar, como a família lê");
  eq(Preco.precoDoGrupo(SEGUNDA, 1).reais, "R$ 550,00", "1f. e sem ponto quando não precisa");
  ok(Preco.precoDoGrupo(SEGUNDA, 2).irmaos && !Preco.precoDoGrupo(SEGUNDA, 1).irmaos,
    "1g. a marca de irmãos só acende de 2 pra cima");
}

// ------------------------------------------------- 2. o que a tabela NÃO faz
{
  eq(Preco.precoDoGrupo(SABADO, 2).centavos, 160000,
    "2. fim de semana não tem preço de irmãos: R$ 800 por criança, e é decisão do Dr. Bruno");
  ok(!Preco.precoDoGrupo(SABADO, 2).irmaos, "2b. e nem se apresenta como irmãos");
  eq(Preco.precoDoGrupo(SEGUNDA, 0).centavos, 55000, "2c. zero ou lixo cai em uma criança, nunca em zero reais");
  eq(Preco.precoDoGrupo(SEGUNDA, "abc").centavos, 55000, "2d. texto no lugar de número idem");
  eq(Preco.precoDaConsulta(SEGUNDA).centavos, 55000, "2e. a função antiga continua sendo 'uma criança'");
}

// ------------------------------------------------- 3. a máquina lê o valor de volta
{
  // Sem isto a Carla escreve "R$ 1.000" e a reserva trava pra sempre.
  eq(lerPreco("O atendimento é particular. O valor é R$ 550, em Pix ou cartão."), 55000, "3. R$ 550 continua lido");
  eq(lerPreco("O atendimento é particular. R$ 800 no fim de semana."), 80000, "3b. R$ 800 também");
  eq(lerPreco("O atendimento é particular. Pra duas crianças fica R$ 500 cada, R$ 1.000 pelas duas."), 100000,
    "3c. 'R$ 500 cada, R$ 1.000 pelas duas' é UMA informação: vale o total");
  eq(lerPreco("O atendimento é particular. Os três ficam em R$ 1.500 no total."), 150000, "3d. três crianças");
  eq(lerPreco("O atendimento é particular. R$ 1000 pelas duas."), 100000, "3e. sem o ponto de milhar também vale");
  eq(lerPreco("O atendimento é particular. R$ 1.000,00 pelas duas."), 100000, "3f. com centavos também");
}

// ------------------------------------------------- 4. a ambiguidade continua sendo "não sei"
{
  // A trava do valor único existe pra não chutar. Ela não pode ter afrouxado no caminho.
  eq(lerPreco("O atendimento é particular. R$ 550 ou R$ 800, depende do dia."), null,
    "4. dois valores de uma criança: ambíguo, não registra");
  eq(lerPreco("O atendimento é particular. R$ 1.000 ou R$ 1.500, depende de quantos."), null,
    "4b. dois totais de grupo: ambíguo, não registra");
  eq(lerPreco("O valor é R$ 1.000."), null, "4c. sem dizer que é particular, não registra (regra antiga, intacta)");
  eq(lerPreco("O atendimento é particular. R$ 500 cada."), 50000,
    "4d. só 'R$ 500 cada' sem o total registra 500, que não bate com grupo nenhum: a reserva recusa, sem cobrar errado");
}

// ------------------------------------------------- 5. a ferramenta conhece o grupo
{
  ok(/criancasJuntas: \{ type: "integer", minimum: 1/.test(CEREBRO), "5. confirmar_agendamento aceita criancasJuntas");
  ok(/Preco\.precoDoGrupo\(slotFinal, criancasJuntas\)/.test(CEREBRO), "5b. e o preço da reserva é o do grupo");
  ok(/EstadoAtendimento\.precoFoiInformado\(ctx\.estadoAtendimento, grupo\.centavos\)/.test(CEREBRO),
    "5c. a guarda confere o TOTAL do grupo, não o valor de uma criança");
  ok(/const jaMarcadasNoDia = Storage\.lerAgendamentos\(\)[\s\S]{0,200}a\.data === slotFinal\.date/.test(CEREBRO),
    "5d. o tamanho do grupo também é lido da agenda: a segunda chamada enxerga '2' mesmo sem o parâmetro");
  ok(/Math\.max\(\s*Math\.floor\(Number\(input\.criancasJuntas\) \|\| 1\),\s*jaMarcadasNoDia \+ 1,?\s*\)/.test(CEREBRO),
    "5e. o maior dos dois vence: nunca cobra grupo menor do que a agenda mostra");
  ok(/LinksPagamento\.formasParaPreco\(grupo\.centavos\)/.test(CEREBRO), "5f. o link de cartão é o do total");
  ok(/valorDoGrupo: grupo\.reais/.test(CEREBRO), "5g. e a Carla recebe o total pra escrever na mensagem de pagamento");
  ok(/chame de novo com criancasJuntas=\$\{n\}/.test(CEREBRO),
    "5h. se ela informou o total de outro tamanho de grupo, a recusa diz qual parâmetro passar, em vez de fazer a família ouvir o preço de novo");
}

// ------------------------------------------------- 6. o link de cartão do grupo
{
  delete process.env.LINK_PAGAMENTO_IRMAOS_2;
  eq(Link.linkParaCentavos(100000), null, "6. sem link configurado pra R$ 1.000, não manda link nenhum");
  ok(/nem outro link de valor diferente/.test(Link.formasParaPreco(100000).avisoCartao || ""),
    "6b. e o aviso proíbe mandar o link de R$ 550 no lugar");
  process.env.LINK_PAGAMENTO_IRMAOS_2 = "https://link.infinitepay.io/loja/irmaos-1000";
  eq(Link.formasParaPreco(100000).cartao, true, "6c. com o link configurado, cartão liberado");
  process.env.LINK_PAGAMENTO_IRMAOS_2 = "http://127.0.0.1/segredo";
  eq(Link.linkParaCentavos(100000), null, "6d. e link fora do InfinitePay é recusado, igual aos outros");
  delete process.env.LINK_PAGAMENTO_IRMAOS_2;
}

// ------------------------------------------------- 7. cancelou um, o que sobrou volta a 550
{
  const bloco = CEREBRO.slice(CEREBRO.indexOf('if (nome === "cancelar_agendamento")'), CEREBRO.indexOf('if (nome === "escalar_humano")'));
  ok(/const restantesNoDia = Storage\.lerAgendamentos\(\)[\s\S]{0,120}a\.data === removido\.data/.test(bloco),
    "7. depois de cancelar, olha o que sobrou naquele dia");
  ok(/Preco\.precoDoGrupo\(\{ date: removido\.data \}, restantesNoDia\.length\)/.test(bloco),
    "7b. e recalcula o grupo com o tamanho novo: um de dois vira R$ 550");
  ok(/valorAtualizado,?\s*\n?\s*\};/.test(bloco), "7c. devolvendo valorAtualizado pra Carla");
  ok(/chame escalar_humano pro Dr\. Bruno acertar a diferença/.test(bloco),
    "7d. e se o grupo já tinha pago, o acerto é do Dr. Bruno, não promessa da Carla");
}

// ------------------------------------------------- 8. as quatro regras que negavam desconto foram ESCOPADAS
{
  ok(/IRMÃOS AGENDADOS JUNTOS é a ÚNICA exceção ao valor único/.test(SEM_COMENTARIO),
    "8. FATOS: a exceção está escrita ao lado do 'valor único', não noutro canto");
  ok(/Nunca negocia valor nem oferece desconto\./.test(SEM_COMENTARIO),
    "8b. e o 'nunca negocia' continua de pé, intacto");
  ok(/oferecer desconto fora do preço de tabela de irmãos/.test(SEM_COMENTARIO),
    "8c. a lista de NUNCA foi escopada, não apagada");
  ok(/o preço de irmãos NÃO é resposta pra isso/.test(SEM_COMENTARIO),
    "8d. 'não consegue pagar' diz na cara que irmãos não é saída pra quem acha caro uma consulta");
  ok(!/O valor é o mesmo pra todos os casos\./.test(SEM_COMENTARIO),
    "8e. a frase absoluta antiga, que agora seria falsa, não pode continuar");
  ok(/é o do grupo, do jeito que IRMÃOS \/ MAIS DE UMA CRIANÇA manda/.test(SEM_COMENTARIO),
    "8f. e a REGRA SOBRE PREÇO sabe que 'valor pra dois irmãos' é pergunta de grupo");
}

// ------------------------------------------------- 9. a regra de irmãos
{
  ok(/HORÁRIOS SEGUIDOS SÃO O PADRÃO, não um favor a pedido/.test(SEM_COMENTARIO),
    "9. doisSeguidos vira o padrão pra irmãos, sem a família pedir");
  ok(/consultar_horarios com doisSeguidos=true já na primeira busca/.test(SEM_COMENTARIO), "9b. já na primeira busca");
  ok(/R\$ 500 cada, R\$ 1\.000 pelas duas, num pagamento só/.test(SEM_COMENTARIO),
    "9c. o exemplo de frase tem os dois números e o total por último, que é o que a máquina lê");
  ok(/Não diga R\$ 550 pra irmãos/.test(SEM_COMENTARIO), "9d. e proíbe o 550 pra irmãos, que travaria a reserva");
  ok(/passando criancasJuntas com o TOTAL de crianças em TODAS as chamadas/.test(SEM_COMENTARIO),
    "9e. o mesmo criancasJuntas em todas as chamadas do grupo");
  ok(/A mensagem de pagamento sai UMA vez, depois de TODAS as reservas/.test(SEM_COMENTARIO),
    "9f. um pagamento só, depois da última reserva");
  ok(/PRA IRMÃOS, o valor é o valorDoGrupo/.test(SEM_COMENTARIO), "9g. e o modelo da mensagem de Pix sabe usar o total");
  ok(/Deixei separado para vocês: \[horário 1\] pro \[nome 1\] e \[horário 2\] pro \[nome 2\]/.test(SEM_COMENTARIO),
    "9h. com os dois horários e os dois nomes na mesma linha");
  ok(/você não promete estorno nem diz valor de estorno/.test(SEM_COMENTARIO), "9i. estorno é do Dr. Bruno");
}

// ------------------------------------------------- 10. o resto não mudou
{
  ok(/Consulta de segunda a sexta: R\$ 550, valor único/.test(SEM_COMENTARIO), "10. o valor de uma criança é o mesmo");
  ok(/A consulta fica em R\$ 800/.test(SEM_COMENTARIO), "10b. fim de semana idem");
  ok(/dividir em até 3x sem juros no cartão/.test(SEM_COMENTARIO), "10c. o 3x pra quem não consegue pagar continua");
  ok(/valores\.size === 1\) return \[\.\.\.valores\]\[0\];/.test(SERVER), "10d. o caminho de um valor só está intacto");
}

console.log(`\nirmaos-juntos: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
