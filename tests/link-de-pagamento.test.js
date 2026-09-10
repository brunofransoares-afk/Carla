"use strict";

// Um link de cartão por VALOR. O antigo (R$ 550) segue valendo pra tnd; os outros só existem
// se configurados no .env, e link fora do InfinitePay é recusado.
const assert = require("assert");
const Link = require("../link-de-pagamento.js");

for (const v of ["LINK_PAGAMENTO_URGENCIA", "LINK_PAGAMENTO_PUERICULTURA", "LINK_PAGAMENTO_TND", "LINK_PAGAMENTO_SEMANA", "LINK_PAGAMENTO_URGENCIA_FIM_DE_SEMANA"]) delete process.env[v];

assert.match(Link.linkParaCentavos(55000), /^https:\/\/link\.infinitepay\.io\//, "tnd usa o link antigo de R$ 550 por padrão");
assert.equal(Link.linkParaCentavos(35000), null, "urgência sem link configurado: nada");
assert.equal(Link.linkParaCentavos(45000), null, "puericultura sem link configurado: nada");
assert.equal(Link.linkParaCentavos(60000), null, "urgência de fim de semana sem link: nada");
assert.equal(Link.linkParaCentavos(80000), null, "R$ 800 não existe mais");
assert.equal(Link.formasParaPreco(35000).cartao, false);
assert.match(Link.formasParaPreco(35000).avisoCartao, /Não envie link de outro valor/);

process.env.LINK_PAGAMENTO_URGENCIA = "https://link.infinitepay.io/loja/urg-350";
assert.equal(Link.formasParaPreco(35000).cartao, true, "com o link configurado, cartão liberado");
process.env.LINK_PAGAMENTO_URGENCIA = "http://127.0.0.1/segredo";
assert.equal(Link.linkParaCentavos(35000), null, "link fora do InfinitePay é recusado");
process.env.LINK_PAGAMENTO_TND = "https://link.infinitepay.io/loja/tnd-550";
assert.equal(Link.linkParaCentavos(55000), "https://link.infinitepay.io/loja/tnd-550", "tnd configurado vence o padrão");

console.log("link-de-pagamento: passou");
