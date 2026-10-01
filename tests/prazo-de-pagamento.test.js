/*
 * Bateria do prazo de pagamento.
 *
 * O Dr. Bruno tomou um calote e mudou a regra: ninguém é atendido sem ter pago antes.
 *
 *   consulta à TARDE  ->  dá pra pagar até a manhã do mesmo dia
 *   consulta de MANHÃ ->  tem que estar pago no dia anterior
 *
 * A conta é código porque errar aqui é dizer pra família um prazo que não existe, e ela
 * chegar sem ter pago achando que estava dentro do combinado. Que é o que acabou de custar
 * uma consulta.
 *
 * Roda com:  node tests/prazo-de-pagamento.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { prazoDePagamento } = require(path.join(__dirname, "..", "prazo-de-pagamento.js"));

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const slot = (date, time) => ({ date, time });
// 2026-08-03 é uma segunda-feira. 04/08 terça, 05/08 quarta, 06/08 quinta, 07/08 sexta.
const em = (data, hora) => {
  const [a, m, d] = data.split("-").map(Number);
  const [hh, mm] = hora.split(":").map(Number);
  return new Date(a, m - 1, d, hh, mm);
};

// ------------------------------------------------- 1. o prazo é o horário da consulta, e ponto
// Dito pelo Dr. Bruno em 10/09, depois de uma consulta de verdade ter vencido em 13 minutos:
// "o prazo do pagamento é até o horário da consulta". Quem confirma é ele, no "pago".
{
  for (const [data, hora, agora] of [
    ["2026-08-06", "14:00", ["2026-08-03", "10:00"]],
    ["2026-08-06", "08:00", ["2026-08-03", "10:00"]],
    ["2026-08-03", "16:00", ["2026-08-03", "08:30"]],
    ["2026-08-03", "14:00", ["2026-08-03", "13:47"]],
    ["2026-08-04", "08:00", ["2026-08-03", "23:59"]],
  ]) {
    const r = prazoDePagamento(slot(data, hora), em(...agora));
    eq(r.texto, "até o horário da consulta", `1. ${data} ${hora}, marcada em ${agora.join(" ")}: a frase é sempre a mesma`);
    eq(r.expiraEm, null, "1b. e não existe vencimento automático");
    eq(r.agora, false, "1c. nem 'pague agora'");
  }
  ok(/em cima da hora|13 minutos/.test(fs.readFileSync(path.join(__dirname, "..", "prazo-de-pagamento.js"), "utf8")),
    "1d. o arquivo conta o caso que derrubou a regra antiga, pra ninguém trazer ela de volta sem saber");
}

// ------------------------------------------------- 2. a validação do horário continua
{
  let erro = null;
  try { prazoDePagamento(slot("2026-13-01", "14:00"), em("2026-08-03", "10:00")); } catch (e) { erro = e; }
  ok(erro instanceof TypeError, "2. data inválida ainda estoura");
  erro = null;
  try { prazoDePagamento(slot("2026-08-06", "25:00"), em("2026-08-03", "10:00")); } catch (e) { erro = e; }
  ok(erro instanceof TypeError, "2b. hora inválida também");
}

// ------------------------------------------------- 3. a reserva não vence sozinha
{
  const storage = fs.readFileSync(path.join(__dirname, "..", "storage-node.js"), "utf8").replace(/\r\n/g, "\n");
  ok(!/limiteDePagamento/.test(storage), "3. o cálculo de vencimento padrão saiu do storage");
  ok(/expiresAt: expiracao \? expiracao\.toISOString\(\) : null,/.test(storage), "3b. reserva nova nasce sem expiresAt, a não ser que alguém passe um explicitamente");
  ok(/if \(!copia\.expiresAt\) copia\.expiresAt = null;/.test(storage), "3c. e a normalização não inventa um");
  ok(/item\.expiresAt = null;\n    \/\/ Se um clique em "Pago" foi desfeito/.test(storage), "3d. desmarcar pago não recoloca prazo");
  ok(/NÃO EXISTE MAIS PRAZO AUTOMÁTICO/.test(storage), "3e. escrito no lugar onde o cálculo morava");
  const cerebro = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8").replace(/\r\n/g, "\n");
  ok(!/pagarAgora|expiraEm/.test(cerebro), "3f. a ferramenta não devolve mais 'pague agora' nem vencimento");
}

// ------------------------------------------------- 4. o prompt parou de apressar
{
  const cerebro = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8").replace(/\r\n/g, "\n");
  const prompt = cerebro.slice(cerebro.indexOf("const PROMPT_ESTAVEL = `"), cerebro.indexOf("function montarSystemPrompt("));
  ok(/O PRAZO DE PAGAMENTO É ATÉ O HORÁRIO DA CONSULTA, SEMPRE\./.test(prompt), "4. a regra nova está no prompt");
  ok(/nunca diga "até amanhã", "ainda hoje", "de manhã", "agora"/.test(prompt), "4b. com as frases antigas proibidas uma a uma");
  ok(/Mas também NUNCA apressa/.test(prompt) && /contagem regressiva nem ameaça de perder o horário/.test(prompt), "4c. e a pressa proibida por nome");
  ok(/\nO pagamento pode ser feito até o horário da consulta\.\n/.test(prompt), "4d. a linha do pagamento na mensagem de reserva é essa, sozinha e sem negrito");
  ok(!/O horário fica guardado até o pagamento/.test(prompt), "4e. a frase do print de 10/09 saiu");
  ok(!/que precisa ser feito/.test(prompt) && (prompt.match(/precisa ser feito/g) || []).length === 1, "4f. e 'precisa ser feito' só sobrevive dentro da própria proibição");
  ok(!/pagarAgora/.test(prompt), "4g. e a Carla não sabe mais o que é 'pague agora'");
}

// ------------------------------------------------- 9. a trava reconhece as palavras novas
// A Carla parou de dizer "reservado" e passou a dizer "separado". A trava que impede ela de
// dar um horário como certo sem ter chamado a ferramenta olhava só as palavras antigas, e
// teria virado enfeite justamente na regra que o Dr. Bruno acabou de criar.
{
  const fonte = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
  const achado = fonte.match(/const PARECE_CONFIRMACAO_REGEX = (\/.+\/i);/);
  ok(!!achado, "9. achei a trava no código pra poder exercitar de verdade");
  if (achado) {
    const trava = eval(achado[1]);  // eslint-disable-line no-eval
    for (const frase of [
      "Deixei separado para você: quinta-feira (06/08) às 8h.",
      "Deixei guardado pra você esse horário.",
      "Separei o horário aqui!",
      "Deixei reservado para você.",
      "A consulta está confirmada.",
    ]) {
      ok(trava.test(frase), `9. a trava pega "${frase.slice(0, 32)}..."`);
    }
    for (const frase of [
      "Tenho quinta às 8h ou quinta às 14h. Qual fica melhor?",
      "O valor é R$ 550, em Pix ou cartão via link de pagamento.",
      "Vou separar um tempinho pra te explicar como funciona.",
    ]) {
      ok(!trava.test(frase), `9. e não dispara à toa em "${frase.slice(0, 32)}..."`);
    }
  }
}

// ------------------------------------------------- 10. o resto da regra continua escrito
{
  const fonte = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8").replace(/\r\n/g, "\n");
  ok(/PAGAMENTO ANTES DA CONSULTA, SEM EXCEÇÃO/.test(fonte),
    "10. a regra está no prompt");
  ok(!/em dinheiro, Pix ou cartão/.test(fonte),
    "10. a frase pronta do preço não oferece mais dinheiro");
  ok(!/Pagamento: Pix, dinheiro/.test(fonte),
    "10. e dinheiro saiu das formas de pagamento (só existe presencialmente, no dia)");
  ok(/prazoPagamento/.test(fonte),
    "10. o prazo calculado chega até ela pela ferramenta");

  // A linha do pagamento tem que ficar sozinha e em negrito, e o valor tem que aparecer
  // junto da chave Pix. As duas coisas são o mesmo problema: a informação que decide se a
  // consulta acontece some quando fica no meio de um parágrafo ou uma tela acima.
  ok(/\nO pagamento pode ser feito até o horário da consulta\.\n/.test(fonte),
    "10. a linha do pagamento fica sozinha na mensagem de reserva, sem pressa");
  ok(/A chave Pix é o e-mail \(\[valorDaConsulta que a ferramenta devolveu, ex: R\$ 450,00\]\):/.test(fonte),
    "10. e a chave Pix vai com o valor entre parênteses");

  // O botão "Pago" do painel é o gatilho da confirmação: é o Dr. Bruno dizendo que viu o
  // dinheiro no extrato. Se esse encanamento sumir, ele marca pago e a família nunca sabe.
  const painel = fs.readFileSync(path.join(__dirname, "..", "painel-server.js"), "utf8");
  ok(/encaminharAoBot\("\/interno\/pagamento-confirmado"/.test(painel),
    "10. marcar pago no painel avisa a família");
  ok(/if \(ok && pago &&/.test(painel),
    "10. só quando MARCA, nunca ao desmarcar");

  const bot = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  ok(/req\.url === "\/interno\/pagamento-confirmado"/.test(bot), "10. e o bot escuta esse caminho");
  ok(/if \(a\.pagamentoAvisadoEm\) return \{ ok: true, jaAvisado: true \};/.test(bot),
    "10. com trava contra mandar duas vezes, porque clique repetido acontece");
  ok(/está confirmada para/.test(bot),
    "10. e a mensagem confirma a consulta, o único momento em que essa palavra vale");

  /*
   * O E-MAIL E A DATA MUDARAM DE LUGAR DUAS VEZES, e as duas por motivo real.
   *
   * Iam na mensagem da reserva, que ficava com cinco assuntos, e a família respondia um e
   * esquecia o resto. Foram pra confirmação do pagamento, onde ela acabou de pagar. Só que
   * ali chegam tarde: quem paga três dias depois só é perguntado três dias depois, e quem
   * nunca paga nunca é perguntado. O dono, em 01/10/2026: "isso tem que ser perguntado depois
   * que ela fechou a consulta, já escolheu um horário... mas não precisa ter feito o pagamento".
   *
   * Agora são os dois momentos, e nenhum deles empilha: o pedido sai sozinho logo depois da
   * reserva, e a confirmação pede o que AINDA faltar. O texto é um só (pedido-de-dados.js),
   * senão as duas frases divergem na primeira vez que alguém mexer numa delas.
   */
  ok(/const pedido = PedidoDeDados\.trechoNaConfirmacao\(a\);/.test(bot),
    "10. a confirmação continua pedindo o que faltar, pelo texto compartilhado");
  ok(/await pedirDadosDoPortal\(resultado\.acoes, telefone, jid\);/.test(bot),
    "10b. e o pedido sai logo depois da reserva, sem esperar o pagamento");
  ok(/chaveIdempotencia: `dados-do-portal:\$\{acao\.slotId\}`/.test(bot),
    "10c. uma vez por reserva, senão um reenvio pergunta duas vezes a mesma coisa");

  const prompt = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8").replace(/\r\n/g, "\n");
  ok(/NESSA MENSAGEM VOCÊ NÃO PEDE E-MAIL NEM DATA DE NASCIMENTO/.test(prompt),
    "10. e a Carla foi proibida de antecipar esse pedido na mensagem da reserva");
  ok(/VOCÊ NÃO PERGUNTA MAIS "PIX OU CARTÃO\?"/.test(prompt),
    "10. a chave Pix vai direto, sem gastar uma ida e volta perguntando a forma");

  const storage = fs.readFileSync(path.join(__dirname, "..", "storage-node.js"), "utf8");
  ok(/pago: false/.test(storage), "10. todo agendamento novo nasce como não pago");
  ok(/function marcarPagamento\(slotId, pago/.test(storage),
    "10. e existe como o Dr. Bruno virar isso pelo painel");
}

console.log(erros.map((e) => "  FALHA " + e).join("\n"));
console.log(`prazo-de-pagamento: ${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
