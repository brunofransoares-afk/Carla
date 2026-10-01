/*
 * Bateria: as Ações ficam no topo da ficha, com botões grandes.
 *
 * O dono (2026-10-01): "o botão das ações tá lá embaixo. Eu quero que jogue mais pra cima, e
 * coloca botões grandes. Fica aquele botãozinho pequenininho, minúsculo ali."
 *
 * Roda com:  node tests/acoes-no-topo.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0;
const erros = [];
function ok(cond, nome) { if (typeof nome !== "string") throw new Error("ok(cond, nome)"); if (cond) passou++; else erros.push(nome); }

const TELA = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");

// O aviso de "Carla pausada" (só aparece quando ele escreveu pelo celular) pode vir antes.
const montagem = (TELA.match(/\n\s*(?:\$\{avisoPausa\})?\$\{acoes\}[^\n]*`;/) || [""])[0].trim().replace(/^\$\{avisoPausa\}/, "");
ok(/^\$\{acoes\}\$\{caixa\}\$\{dados\}/.test(montagem), "1. a ficha começa pelas Ações, com a caixa de mensagem logo embaixo");
ok(montagem.indexOf("${acoes}") < montagem.indexOf("${consultas}") && montagem.indexOf("${acoes}") < montagem.indexOf("${historico}"),
  "1b. antes das consultas e do histórico");
ok((montagem.match(/\$\{acoes\}/g) || []).length === 1, "1c. e uma vez só");

ok(/<h3>Ações<\/h3><div class="contato-botoes acoes-grandes">/.test(TELA), "2. os botões das Ações ganham a classe dos grandes");
const regra = (TELA.match(/\.acoes-grandes button \{[^}]*\}/) || [""])[0];
const fonte = Number((regra.match(/font-size:\s*(\d+)px/) || [])[1]);
const altura = Number((regra.match(/min-height:\s*(\d+)px/) || [])[1]);
ok(fonte >= 14, "2b. letra de 14px pra cima (era 10.5px)");
ok(altura >= 44, "2c. pelo menos 44px de altura, o tamanho de um dedo");
// REPAGINADA (outubro de 2026): o botão pequeno da lista também ganhou tamanho de dedo. O que o 2d
// guardava ("só a ficha mudou") deixou de valer de propósito; agora ele confere o contrário, e mais forte.
const miniRegra = (TELA.match(/\.btn-mini \{[^}]*\}/) || [""])[0];
ok(Number((miniRegra.match(/font-size:\s*(\d+)px/) || [])[1]) >= 14, "2d. o botão pequeno da lista também tem letra de 14px pra cima");
ok(/button \{[^}]*min-height: var\(--alvo\)/.test(TELA) && /--alvo: 44px/.test(TELA), "2e. e todo botão tem 44px de altura mínima");

ok(/\.msg-manual\[hidden\] \{ display: none; \}/.test(TELA), "3. a caixa de mensagem só aparece quando aberta, senão ocupa o topo à toa");

console.log(`acoes-no-topo: ${passou} passaram, ${erros.length} falharam`);
if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
