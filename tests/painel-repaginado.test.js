/*
 * Bateria de NAVEGADOR da repaginada do painel (Playwright + Chromium).
 *
 * Sobe o painel de verdade numa cópia do repositório, com dados inventados (tests/fixtures/painel-semeado.js),
 * e confere em 390x844 (iPhone) e 1280x800 (computador):
 *   - a tela Hoje aparece, com as pendências em cartões;
 *   - a barra de navegação tem 5 itens e navega (embaixo no celular);
 *   - todo botão, campo e aba tem 44px ou mais;
 *   - nenhum texto abaixo de 14px;
 *   - nenhum erro de página e nenhuma rolagem horizontal, em nenhuma aba;
 *   - nenhum travessão em texto visível;
 *   - sem dado, as funções novas dizem "sem dado ainda" (painel vazio);
 *   - a busca do topo acha a família e a ficha grava origem.
 *
 * Roda com:  NODE_PATH=/opt/node22/lib/node_modules node tests/painel-repaginado.test.js
 * Sem Playwright ou sem Chromium a bateria PULA (e avisa), a não ser que EXIGE_NAVEGADOR=1.
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }

let chromium;
const EXECUTAVEL = ["/opt/pw-browsers/chromium"].find((c) => fs.existsSync(c));
try { ({ chromium } = require("playwright")); } catch {
  try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); } catch { chromium = null; }
}
if (!chromium) {
  console.log("painel-repaginado: PULADO (Playwright não instalado). Use NODE_PATH=/opt/node22/lib/node_modules.");
  process.exit(process.env.EXIGE_NAVEGADOR === "1" ? 1 : 0);
}
const { subir } = require("./fixtures/painel-semeado.js");

const TELAS = [
  { nome: "celular 390x844", viewport: { width: 390, height: 844 }, mobile: true },
  { nome: "computador 1280x800", viewport: { width: 1280, height: 800 }, mobile: false },
];
const ABAS = ["hoje", "familias", "agenda", "numeros", "mais"];

// Mede, dentro da página, tudo que é visível: alvos de toque, letras e rolagem.
function medir() {
  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };
  const descricao = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}"`;
  const pequenos = [];
  const alvos = document.querySelectorAll("button, select, summary, textarea, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), a.botao, .ficha-tel a, .funil-rodape a, [role=tab]");
  for (const el of alvos) {
    if (!visivel(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 43.5) pequenos.push(`${descricao(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  // Caixas de marcar: o rótulo que as envolve é o alvo.
  for (const el of document.querySelectorAll("input[type=checkbox]")) {
    if (!visivel(el)) continue;
    const r = (el.closest("label") || el).getBoundingClientRect();
    if (r.height < 43.5) pequenos.push(`checkbox ${descricao(el.closest("label") || el)} ${Math.round(r.height)}`);
  }
  const letras = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    if (!el || ["SCRIPT", "STYLE", "OPTION"].includes(el.tagName) || !visivel(el)) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 13.99) letras.push(`${px}px em ${descricao(el)}`);
  }
  return {
    pequenos, letras,
    rolagemX: document.documentElement.scrollWidth - window.innerWidth,
    travessao: /—/.test(document.body.innerText),
  };
}

async function entrar(contexto, s) {
  const pagina = await contexto.newPage();
  pagina.errosDePagina = [];
  pagina.on("pageerror", (e) => pagina.errosDePagina.push(e.message));
  await pagina.goto(s.url + "/login");
  await pagina.fill("#senha", s.senha);
  await Promise.all([pagina.waitForURL((u) => !u.pathname.startsWith("/login")), pagina.click("button[type=submit]")]);
  await pagina.waitForSelector("#abas");
  await pagina.waitForTimeout(1200);
  return pagina;
}

(async () => {
  const navegador = await chromium.launch(EXECUTAVEL ? { executablePath: EXECUTAVEL } : {});
  let cheio = null, vazio = null;
  try {
    for (const tela of TELAS) {
      const novoContexto = () => navegador.newContext({ viewport: tela.viewport, isMobile: tela.mobile, hasTouch: tela.mobile, locale: "pt-BR", deviceScaleFactor: 2 });
      const rot = (t) => `${tela.nome}: ${t}`;

      // Servidores novos a cada tela: o teste grava (origem, follow-up) e uma tela não pode herdar da outra.
      cheio = await subir("cheio");
      vazio = await subir("vazio");
      // ------------------------------------------------ painel com dados
      const ctx = await novoContexto();
      const p = await entrar(ctx, cheio);

      ok(await p.locator('.aba[data-aba="hoje"]').evaluate((e) => e.dataset.ativa === "true"), rot("1. a tela Hoje é a de abertura"));
      ok(await p.locator("#lista-pendencias .pendencia").count() >= 5, rot("1b. as pendências do dia aparecem em cartões"));
      const tipos = await p.locator("#lista-pendencias .tipo-etiqueta").allTextContents();
      for (const esperado of ["Responder", "Pagamento pendente", "Retorno a avisar", "Pós-consulta", "Parou depois do valor", "Follow-up de 7 dias"]) {
        ok(tipos.some((t) => t.includes(esperado)) || (await p.locator("#btn-mais-pendencias").isVisible()), rot(`1c. pendência "${esperado}"`));
      }
      ok(/^\d+$/.test((await p.locator("#kpi-hoje").textContent()).trim()) && await p.locator(".kpi-valor").first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize) >= 32), rot("1d. números principais grandes"));
      ok((await p.locator("#hoje-titulo").textContent()).length > 5, rot("1e. a data de hoje no título"));

      // barra de navegação
      const abas = p.locator("#abas button[data-aba]");
      ok(await abas.count() === 5, rot("2. a barra tem 5 itens"));
      const caixaNav = await p.locator("#abas").boundingBox();
      if (tela.mobile) ok(Math.abs(caixaNav.y + caixaNav.height - tela.viewport.height) < 2 && caixaNav.width >= tela.viewport.width - 1, rot("2b. no celular a barra fica embaixo, de lado a lado"));
      else ok(caixaNav.x < 2 && caixaNav.height >= tela.viewport.height - 2, rot("2b. no computador a barra é lateral"));

      // busca sempre à mão: visível em todas as abas
      for (const aba of ABAS) {
        await p.click(`#abas button[data-aba="${aba}"]`);
        await p.waitForTimeout(250);
        ok(await p.locator(`.aba[data-aba="${aba}"]`).evaluate((e) => e.dataset.ativa === "true"), rot(`2c. a barra abre ${aba}`));
        ok(await p.locator("#busca-global").isVisible(), rot(`2d. a busca está à mão em ${aba}`));
        const m = await p.evaluate(medir);
        ok(m.pequenos.length === 0, rot(`3. alvos de 44px ou mais em ${aba}: ${m.pequenos.slice(0, 4).join(" | ")}`));
        ok(m.letras.length === 0, rot(`4. letras de 14px ou mais em ${aba}: ${[...new Set(m.letras)].slice(0, 4).join(" | ")}`));
        ok(m.rolagemX <= 0, rot(`5. sem rolagem horizontal em ${aba} (sobra ${m.rolagemX}px)`));
        ok(!m.travessao, rot(`6. sem travessão em texto visível em ${aba}`));
      }

      // a busca do topo acha a família e abre a ficha
      await p.click('#abas button[data-aba="hoje"]');
      await p.fill("#busca-global", "mariana");
      await p.waitForSelector("#resultados-busca .resultado-busca");
      ok(await p.locator("#resultados-busca .resultado-busca").count() === 1, rot("7. a busca por nome acha a família"));
      await p.click("#resultados-busca .resultado-busca");
      await p.waitForSelector("#ficha-corpo .ficha-nome");
      ok((await p.locator("#ficha-corpo .ficha-nome").textContent()).includes("Mariana"), rot("7b. e abre a ficha dela"));
      ok(await p.locator('.aba[data-aba="familias"]').evaluate((e) => e.dataset.ativa === "true"), rot("7c. na seção Famílias"));
      ok(await p.locator("#ficha-corpo .acoes-grandes").isVisible(), rot("7d. com as ações grandes no topo (não desfeito)"));
      ok(await p.locator("#select-origem").isVisible() && await p.locator("#btn-marcar-perda").isVisible(), rot("7e. a ficha tem origem e motivo de perda"));
      const mf = await p.evaluate(medir);
      ok(mf.pequenos.length === 0, rot(`7f. ficha aberta: alvos de 44px (${mf.pequenos.slice(0, 4).join(" | ")})`));
      ok(mf.letras.length === 0, rot(`7g. ficha aberta: letras de 14px (${[...new Set(mf.letras)].slice(0, 4).join(" | ")})`));
      ok(mf.rolagemX <= 0, rot(`7h. ficha aberta sem rolagem horizontal (${mf.rolagemX})`));
      if (tela.mobile) ok(await p.locator("#busca-global").isVisible() && await p.locator("#abas").isVisible(), rot("7i. com a ficha aberta, busca e barra continuam à mão"));

      // grava origem pela ficha e confere no servidor
      await p.selectOption("#select-origem", "Google");
      await p.waitForTimeout(900);
      const crm = await p.evaluate(async () => (await fetch("/api/crm")).json());
      const mariana = crm.contatos.find((c) => c.nome === "Mariana Lopes");
      ok(mariana && mariana.origem === "Google", rot("8. a origem escolhida na ficha ficou gravada"));

      // cartão de pendência leva à ficha; follow-up feito tira da lista
      await p.click('#abas button[data-aba="hoje"]');
      await p.waitForTimeout(300);
      const antes = await p.locator('#lista-pendencias [data-followup]').count();
      if (antes > 0) {
        await p.locator('#lista-pendencias [data-followup]').first().click();
        await p.waitForTimeout(1200);
        ok(await p.locator('#lista-pendencias [data-followup]').count() < antes, rot("9. 'Já fiz o follow-up' tira o cartão da lista"));
      } else ok(false, rot("9. havia cartão de follow-up para testar"));

      // Números com dado: gargalo e taxa de passagem
      await p.click('#abas button[data-aba="numeros"]');
      await p.waitForTimeout(800);
      ok(/GARGALO/.test(await p.locator("#funil-corpo").textContent()) && /passaram da etapa anterior/.test(await p.locator("#funil-corpo").textContent()), rot("10. o funil mostra a taxa de passagem e o gargalo"));
      ok(/R\$\s?\d/.test(await p.locator("#numeros-mes").textContent()), rot("10b. faturamento recebido em reais"));
      ok(/Instagram/.test(await p.locator("#numeros-origens").textContent()) && /Achou caro/.test(await p.locator("#numeros-perdas").textContent()), rot("10c. origem e motivo de perda com dado"));
      ok(/Semana passada/.test(await p.locator("#numeros-semana").textContent()), rot("10d. relatório da semana"));
      ok(p.errosDePagina.length === 0, rot("11. nenhum erro de página com dados: " + p.errosDePagina.join(" | ")));
      await ctx.close();

      // ------------------------------------------------ painel vazio: sem dado ainda
      const ctxV = await novoContexto();
      const v = await entrar(ctxV, vazio);
      ok(/Nada pendente/.test(await v.locator("#lista-pendencias").textContent()), rot("12. Hoje vazio diz que não há pendência"));
      await v.click('#abas button[data-aba="numeros"]');
      await v.waitForTimeout(800);
      const nm = await v.locator("#numeros-mes").textContent();
      const no = await v.locator("#numeros-origens").textContent();
      const np = await v.locator("#numeros-perdas").textContent();
      ok(/sem dado ainda/i.test(nm), rot("12b. mês contra mês: sem dado ainda"));
      ok(/sem dado ainda/i.test(no), rot("12c. origem: sem dado ainda"));
      ok(/sem dado ainda/i.test(np), rot("12d. motivo de perda: sem dado ainda"));
      ok(/sem dado ainda/i.test(await v.locator("#numeros-semana").textContent()), rot("12e. semana: sem dado ainda"));
      ok(!/R\$ 0,00/.test(nm), rot("12f. e não inventa zero em reais"));
      for (const aba of ABAS) {
        await v.click(`#abas button[data-aba="${aba}"]`);
        await v.waitForTimeout(200);
        const m = await v.evaluate(medir);
        ok(m.rolagemX <= 0 && m.pequenos.length === 0 && m.letras.length === 0, rot(`12g. painel vazio em ${aba}: sem rolagem, alvos e letras ok`));
      }
      ok(v.errosDePagina.length === 0, rot("13. nenhum erro de página no painel vazio: " + v.errosDePagina.join(" | ")));
      await ctxV.close();
      await cheio.parar(); await vazio.parar(); cheio = vazio = null;
    }

    // ------------------------------------------------ o que o arquivo promete
    const tela = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");
    ok(/viewport-fit=cover/.test(tela), "14. a página ocupa a tela toda do iPhone (viewport-fit=cover)");
    for (const lado of ["top", "bottom", "left", "right"]) ok(tela.includes(`env(safe-area-inset-${lado}`), `14b. respeita a área segura: ${lado}`);
  } finally {
    await navegador.close();
    if (cheio) await cheio.parar();
    if (vazio) await vazio.parar();
  }
  console.log(`painel-repaginado: ${passou} passaram, ${falhou} falharam`);
  if (falhou) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
