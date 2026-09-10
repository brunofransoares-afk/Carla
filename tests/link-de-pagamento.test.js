"use strict";

// Um link de cartão por VALOR. O antigo (R$ 550) segue valendo pra tnd; os outros só existem
// se configurados no .env, e link fora do InfinitePay é recusado.
const assert = require("assert");
const Link = require("../link-de-pagamento.js");

for (const v of ["LINK_PAGAMENTO_URGENCIA", "LINK_PAGAMENTO_PUERICULTURA", "LINK_PAGAMENTO_TND", "LINK_PAGAMENTO_SEMANA", "LINK_PAGAMENTO_URGENCIA_FIM_DE_SEMANA"]) delete process.env[v];

assert.match(Link.linkParaCentavos(55000), /^https:\/\/link\.infinitepay\.io\//, "tnd usa o link antigo de R$ 550 por padrão");
// Os links de R$ 450 e R$ 350 que o Dr. Bruno gerou em 10/09/2026 vivem no código como
// padrão, igual ao de R$ 550: sem .env nenhum a Carla já manda o link certo de cada valor.
assert.equal(Link.linkParaCentavos(35000), "https://link.infinitepay.io/brunoffsoares/VC1D-zrz07w86oA-350,00", "urgência: o link de R$ 350");
assert.equal(Link.linkParaCentavos(45000), "https://link.infinitepay.io/brunoffsoares/VC1D-biYWpCgYs2-450,00", "puericultura: o link de R$ 450");
assert.match(Link.linkParaCentavos(35000), /-350,00$/, "e o link de R$ 350 termina no valor dele, não em outro");
assert.match(Link.linkParaCentavos(45000), /-450,00$/, "idem R$ 450");
assert.equal(Link.linkParaCentavos(60000), null, "urgência de fim de semana sem link: nada (esse ainda não existe)");
assert.equal(Link.linkParaCentavos(80000), null, "R$ 800 não existe mais");
assert.equal(Link.formasParaPreco(60000).cartao, false);
assert.match(Link.formasParaPreco(60000).avisoCartao, /Não envie link de outro valor/);

process.env.LINK_PAGAMENTO_URGENCIA = "https://link.infinitepay.io/loja/urg-350";
assert.equal(Link.linkParaCentavos(35000), "https://link.infinitepay.io/loja/urg-350", "o .env vence o padrão");
process.env.LINK_PAGAMENTO_URGENCIA = "http://127.0.0.1/segredo";
assert.equal(Link.linkParaCentavos(35000), Link.LINK_URGENCIA_PADRAO, "link fora do InfinitePay é recusado e cai no padrão");

// PARCELAMENTO: só a de R$ 550 divide em 3x sem juros. As outras são à vista; a família
// pode parcelar no cartão dela pelo link, mas as taxas são dela.
assert.equal(Link.parcelasSemJuros(55000), 3, "R$ 550 divide em 3x");
assert.equal(Link.parcelasSemJuros(45000), 1, "R$ 450 é à vista");
assert.equal(Link.parcelasSemJuros(35000), 1, "R$ 350 é à vista");
assert.equal(Link.parcelasSemJuros(60000), 1, "R$ 600 é à vista");
assert.match(Link.formasParaPreco(55000).parcelamento, /até 3x sem juros/, "a ferramenta diz que a de R$ 550 pode dividir");
assert.match(Link.formasParaPreco(55000).parcelamento, /se a família perguntar/, "e só se perguntarem");
assert.match(Link.formasParaPreco(45000).parcelamento, /à vista/, "e que a de R$ 450 é à vista");
assert.match(Link.formasParaPreco(45000).parcelamento, /taxas do parcelamento ficam por conta dela/, "com a regra de quem paga a taxa se ela parcelar mesmo assim");
assert.doesNotMatch(Link.formasParaPreco(45000).parcelamento, /3x/, "sem 3x na de R$ 450");
process.env.LINK_PAGAMENTO_TND = "https://link.infinitepay.io/loja/tnd-550";
assert.equal(Link.linkParaCentavos(55000), "https://link.infinitepay.io/loja/tnd-550", "tnd configurado vence o padrão");

console.log("link-de-pagamento: passou");
