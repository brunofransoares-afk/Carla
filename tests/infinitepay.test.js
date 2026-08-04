/*
 * Bateria da conversa com a InfinitePay.
 *
 * A máquina onde este código foi escrito não alcança infinitepay.io (bloqueio de rede do
 * ambiente), então a bateria exercita a montagem da requisição e a leitura da resposta com
 * um fetch de mentira. Não é preguiça: é o que dá pra garantir sem rede, e é justamente
 * onde moram os erros que custam dinheiro (fator 100 no valor, campo com nome errado,
 * "não achei" lido como "pagou").
 *
 * O contrato conferido aqui é o da documentação oficial dentro do app, não o de blog:
 * duas fontes de terceiros me deram endereço e nome de campo errados antes disso.
 *
 * Roda com:  node tests/infinitepay.test.js
 */
"use strict";
const path = require("path");
const IP = require(path.join(__dirname, "..", "infinitepay.js"));

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const env = { INFINITEPAY_HANDLE: "brunoffsoares" };

// A URL que a API devolveu de verdade, no teste feito pelo app do Dr. Bruno. Fica aqui
// literal de propósito: eu tinha escrito cinco palpites de nome de campo e nenhum era
// "checkout_url", e nenhum previa identificador em parâmetro em vez de caminho.
const RESPOSTA_REAL = "https://checkout.infinitepay.io/brunoffsoares?lenc=G5gAYGTwpvYEBnheZn171wskgfc50NDSyYHD8WtBWxAEEmYShhAGnbHSnPIslPH2ETSsMsKseJ8EfhtI6EzXESEQYmpASn3ssXqofOx2Ooy-Z5GVelmPnF0zHca0Hm9_0r-SyDOe7cgj4HrAq70g9qOhNL0xkDyiIgc.v1.ffdcfa5923382412";

// fetch de mentira: guarda o que foi pedido e devolve o que mandarem.
function fetchFalso(resposta, registro = {}) {
  return async (url, opcoes) => {
    registro.url = url;
    registro.corpo = JSON.parse(opcoes.body);
    registro.metodo = opcoes.method;
    return {
      ok: resposta.status ? resposta.status < 400 : true,
      status: resposta.status || 200,
      text: async () => (typeof resposta.corpo === "string" ? resposta.corpo : JSON.stringify(resposta.corpo)),
    };
  };
}

(async () => {
// ------------------------------------------------- 1. desligado sem handle
{
  ok(!IP.estaLigado({}), "1. sem INFINITEPAY_HANDLE o módulo fica desligado");
  ok(IP.estaLigado(env), "1. com handle, ligado");
  eq(IP.handleConfigurado({ INFINITEPAY_HANDLE: "$brunoffsoares" }), "brunoffsoares",
    "1. o $ do começo é tirado, como a documentação manda");
}

// ------------------------------------------------- 2. a requisição de criar
{
  const reg = {};
  const r = await IP.criarCobranca({
    valorCentavos: 55000,
    descricao: "Consulta com Dr. Bruno Soares",
    orderNsu: "2026-08-06T08:00",
    env,
    // Esta é a resposta de verdade da API, copiada do teste que o Dr. Bruno rodou no app.
    fetchFn: fetchFalso({ corpo: { checkout_url: RESPOSTA_REAL } }, reg),
  });

  eq(reg.url, "https://api.infinitepay.io/invoices/public/checkout/links", "2. o endereço é o da documentação oficial");
  eq(reg.metodo, "POST", "2. POST");
  eq(reg.corpo.handle, "brunoffsoares", "2. manda o handle");
  eq(reg.corpo.order_nsu, "2026-08-06T08:00", "2. o order_nsu é o slotId, que amarra o dinheiro à consulta");
  eq(reg.corpo.items[0].price, 55000, "2. o preço vai em CENTAVOS (R$ 550,00 = 55000)");
  eq(reg.corpo.items[0].quantity, 1, "2. uma consulta");
  ok(reg.corpo.itens, "2. manda também 'itens' em português, porque as duas telas da documentação discordam");

  eq(r.ok, true, "2. deu certo");
  eq(r.url, RESPOSTA_REAL, "2. devolve o link pra família, lido de checkout_url");
  eq(r.slug, null, "2. e NÃO inventa slug: nessa URL o identificador vem no parâmetro lenc, não no caminho");
}

// ------------------------------------------------- 3. valor errado nunca vira cobrança
{
  const respostaBoa = { corpo: { checkout_url: RESPOSTA_REAL } };
  for (const valor of [550, 0, -1, 55000.5, "55000", null, undefined, NaN]) {
    const r = await IP.criarCobranca({ valorCentavos: valor, orderNsu: "x", env, fetchFn: fetchFalso(respostaBoa) });
    // 550 é inteiro e positivo, então passa: seria uma consulta de R$ 5,50, valor esquisito
    // mas legítimo. A trava aqui é contra não-inteiro e contra zero/negativo, não contra
    // valor baixo — quem decide o preço é o prompt, não este arquivo.
    if (valor === 550) { ok(r.ok, "3. 550 centavos passa: é R$ 5,50, esquisito mas legítimo"); continue; }
    eq(r.ok, false, `3. valor ${JSON.stringify(valor)} é recusado antes de virar cobrança`);
  }
}

// ------------------------------------------------- 4. sem order_nsu não cria
{
  const r = await IP.criarCobranca({ valorCentavos: 55000, orderNsu: "", env, fetchFn: fetchFalso({ corpo: {} }) });
  eq(r.ok, false, "4. sem order_nsu não cria: seria dinheiro entrando sem dono");
}

// ------------------------------------------------- 5. pagamento conferido
{
  const reg = {};
  const r = await IP.conferirPagamento({
    orderNsu: "2026-08-06T08:00", slug: "Z8oIyXH5hu", env,
    fetchFn: fetchFalso({ corpo: { success: true, paid: true, amount: 55000, paid_amount: 55000, installments: 1, capture_method: "pix" } }, reg),
  });
  eq(reg.url, "https://api.infinitepay.io/invoices/public/checkout/payment_check", "5. o endereço do payment_check");
  eq(reg.corpo.slug, "Z8oIyXH5hu", "5. manda o slug");
  ok(!("transaction_nsu" in reg.corpo), "5. e não inventa transaction_nsu, que só existe depois de alguém pagar e voltar");
  eq(r.pago, true, "5. pagou");
  eq(r.forma, "pix", "5. e sabe que foi por Pix");
  eq(r.valorCentavos, 55000, "5. com o valor que entrou");
}

// ------------------------------------------------- 6. "não achei" nunca é "pagou"
// O erro mais caro possível deste arquivo: marcar como paga uma consulta que não foi paga.
{
  const casos = [
    { success: true, paid: false },
    { success: false, paid: true },
    { success: false, paid: false },
    { success: true },
    { paid: true },
    {},
  ];
  for (const corpo of casos) {
    const r = await IP.conferirPagamento({ orderNsu: "x", env, fetchFn: fetchFalso({ corpo }) });
    eq(r.pago, false, `6. ${JSON.stringify(corpo)} NÃO conta como pago`);
  }
  const bom = await IP.conferirPagamento({ orderNsu: "x", env, fetchFn: fetchFalso({ corpo: { success: true, paid: true } }) });
  eq(bom.pago, true, "6. só success=true E paid=true conta como pago");
}

// ------------------------------------------------- 7. erro nunca estoura nem vira "pago"
{
  const foraDoAr = await IP.conferirPagamento({
    orderNsu: "x", env,
    fetchFn: async () => { throw new Error("ECONNREFUSED"); },
  });
  eq(foraDoAr.ok, false, "7. InfinitePay fora do ar devolve erro em vez de estourar");
  ok(!foraDoAr.pago, "7. e nunca devolve pago=true por acidente");

  const erro500 = await IP.criarCobranca({
    valorCentavos: 55000, orderNsu: "x", env,
    fetchFn: fetchFalso({ status: 500, corpo: "erro interno" }),
  });
  eq(erro500.ok, false, "7. HTTP 500 na criação é erro tratado, não exceção");

  const naoJson = await IP.criarCobranca({
    valorCentavos: 55000, orderNsu: "x", env,
    fetchFn: fetchFalso({ corpo: "<html>manutenção</html>" }),
  });
  eq(naoJson.ok, false, "7. resposta que não é JSON também é tratada");

  const semLink = await IP.criarCobranca({
    valorCentavos: 55000, orderNsu: "x", env,
    fetchFn: fetchFalso({ corpo: { success: true } }),
  });
  eq(semLink.ok, false, "7. criou mas não veio link: erro, e o motivo mostra o que voltou");
}

// ------------------------------------------------- 8. o link em outros formatos de resposta
{
  // checkout_url é o nome de verdade; os outros são rede de segurança caso mudem.
  const formatos = [
    { checkout_url: "https://invoice.infinitepay.io/brunoffsoares/AAA" },
    { url: "https://invoice.infinitepay.io/brunoffsoares/AAA" },
    { link: "https://invoice.infinitepay.io/brunoffsoares/AAA" },
    { data: { checkout_url: "https://invoice.infinitepay.io/brunoffsoares/AAA" } },
  ];
  for (const corpo of formatos) {
    const r = await IP.criarCobranca({ valorCentavos: 55000, orderNsu: "x", env, fetchFn: fetchFalso({ corpo }) });
    eq(r.slug, "AAA", `8. acha o link em ${Object.keys(corpo)[0]}`);
  }

  // Os dois formatos de URL que existem, e o erro que o segundo causava.
  eq(IP.slugDaUrl("https://invoice.infinitepay.io/brunoffsoares/Z8oIyXH5hu?x=1", "brunoffsoares"), "Z8oIyXH5hu",
    "8. cobrança criada na mão: o código está no caminho, e é isso que vira slug");
  eq(IP.slugDaUrl(RESPOSTA_REAL, "brunoffsoares"), null,
    "8. link criado pela API: nada de slug, porque o último pedaço do caminho é o próprio handle");
  eq(IP.slugDaUrl("https://checkout.infinitepay.io", "brunoffsoares"), null, "8. só domínio não vira slug");
  eq(IP.slugDaUrl(null), null, "8. e não quebra sem URL");
}

console.log(erros.map((e) => "  FALHA " + e).join("\n"));
console.log(`infinitepay: ${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
})();
