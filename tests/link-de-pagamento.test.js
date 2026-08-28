"use strict";

const assert = require("assert");
const Link = require("../link-de-pagamento.js");

assert.match(Link.linkParaCentavos(55000), /^https:\/\/link\.infinitepay\.io\//);
delete process.env.LINK_PAGAMENTO_FIM_DE_SEMANA;
assert.equal(Link.linkParaCentavos(80000), null);
process.env.LINK_PAGAMENTO_FIM_DE_SEMANA = "https://link.infinitepay.io/loja/link-800";
assert.equal(Link.formasParaPreco(80000).cartao, true);
process.env.LINK_PAGAMENTO_FIM_DE_SEMANA = "http://127.0.0.1/segredo";
assert.equal(Link.linkParaCentavos(80000), null);

console.log("link-de-pagamento: passou");
