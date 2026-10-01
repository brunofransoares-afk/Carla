/*
 * Bateria: o botão "Pago" do painel muda na hora, em todo lugar, e avisa quando não salva.
 *
 * O dono: "O botão de pago agora não tá funcionando... Não era pra ele parar de funcionar,
 * era só pra ele parar de disparar a mensagem." O clique salvava, mas na ficha o botão não
 * mudava: a ficha só se redesenha quando nenhum campo dela tem texto, e o e-mail do portal
 * já nasce preenchido. E a recusa do servidor era engolida em silêncio.
 *
 * Roda a função de verdade, tirada do dashboard.html, contra botões de mentira.
 *
 * Roda com:  node tests/botao-pago.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let passou = 0;
const erros = [];
function ok(cond, nome) { if (typeof nome !== "string") throw new Error("ok(cond, nome)"); if (cond) passou++; else erros.push(nome); }

const HTML = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");
const ini = HTML.indexOf("  async function alternarPago(btn) {");
const fim = HTML.indexOf("\n  }\n", ini) + 4;
const fonte = HTML.slice(ini, fim);

function botao(slotId, pago) {
  const classes = new Set(["btn-pago", pago ? "sim" : "nao"]);
  return { dataset: { slotId, pago: pago ? "1" : "0" }, disabled: false, textContent: pago ? "✓" : "R$", title: "",
    classList: { toggle: (c, v) => (v ? classes.add(c) : classes.delete(c)), has: (c) => classes.has(c) } };
}

async function cenario(resposta) {
  const naAgenda = botao("s1", false), naFicha = botao("s1", false), outro = botao("s2", false);
  const ctx = { alertas: [], atualizacoes: 0, pedidos: [] };
  const sandbox = {
    document: { querySelectorAll: (sel) => (sel === ".btn-pago" ? [naAgenda, naFicha, outro] : []) },
    postJSON: async (rota, corpo) => { ctx.pedidos.push({ rota, corpo }); if (resposta === "rede") throw new Error("x"); return { json: async () => resposta }; },
    alert: (m) => ctx.alertas.push(m),
    atualizar: () => ctx.atualizacoes++, atualizarCrm: () => ctx.atualizacoes++,
  };
  vm.createContext(sandbox);
  vm.runInContext(fonte + "\nthis.alternarPago = alternarPago;", sandbox);
  await sandbox.alternarPago(naFicha);
  return { naAgenda, naFicha, outro, ctx };
}

(async () => {
  ok(fonte.length > 100, "0. achei a função no painel");

  {
    const r = await cenario({ ok: true, alterado: true });
    eqPedido(r);
    ok(r.naFicha.textContent === "✓" && r.naFicha.dataset.pago === "1" && r.naFicha.classList.has("sim"),
      "1. o botão clicado vira ✓ assim que o servidor confirma, sem esperar redesenho");
    ok(r.naAgenda.textContent === "✓" && r.naAgenda.dataset.pago === "1",
      "1b. e o gêmeo dele na outra tela também (agenda e ficha mostram a mesma consulta)");
    ok(r.outro.textContent === "R$" && r.outro.dataset.pago === "0", "1c. consulta de outra família não muda");
    ok(!r.naFicha.disabled, "1d. o botão volta a aceitar clique (é interruptor: o próximo desfaz)");
    ok(r.ctx.alertas.length === 0, "1e. sem aviso quando deu certo");
  }
  {
    const r = await cenario({ ok: false, alterado: false });
    ok(r.ctx.alertas.length === 1, "2. recusa do servidor vira aviso, não silêncio");
    ok(r.naFicha.textContent === "R$" && r.naFicha.dataset.pago === "0", "2b. e o botão não finge que pagou");
    ok(!r.naFicha.disabled, "2c. nem fica travado");
  }
  {
    const r = await cenario("rede");
    ok(r.ctx.alertas.length === 1 && r.naFicha.textContent === "R$", "3. sem conexão: avisa e não muda");
  }
  ok(!/pagamento-confirmado|mensagem/.test(fonte.replace(/\/\/.*$/gm, "")), "4. o botão continua sem mandar mensagem nenhuma pela tela");

  console.log(`botao-pago: ${passou} passaram, ${erros.length} falharam`);
  if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });

function eqPedido(r) {
  const p = r.ctx.pedidos[0] || {};
  ok(p.rota === "/api/pagamento-toggle" && p.corpo.slotId === "s1" && p.corpo.pago === true,
    "1a. pede ao servidor pra marcar ESTA consulta como paga");
}
