/*
 * Bateria da aba do funil no painel.
 *
 * A Etapa 1 passou a gravar os eventos. Esta etapa é o que torna aquilo legível: o painel
 * lê o registro e mostra onde a família cai, por que ela chegou, e a conversão HONESTA.
 *
 * DOIS NÚMEROS DE CONVERSÃO NA MESMA TELA É PIOR QUE UM NÚMERO RUIM: ninguém sabe em qual
 * acreditar. O anel que já existia vinha de metricasConversao, que soma lead de convênio com
 * lead particular e conta a vida inteira do sistema no denominador (então só cai, faça o
 * atendimento o que fizer). Ele passou a beber do funil, que é a mesma fonte do cartão novo.
 *
 * A ROTA DO CSV QUASE NASCEU MORTA. Com `startsWith("/api/funil")`, a rota do JSON engolia
 * `/api/funil.csv` e o download nunca acontecia. Peguei isso durante a construção; as duas
 * rotas agora comparam o caminho exato, e tem teste abaixo.
 *
 * Roda com:  node tests/aba-do-funil.test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), "carla-funil-"));
fs.copyFileSync(path.join(__dirname, "..", "registro-de-eventos.js"), path.join(RAIZ, "registro-de-eventos.js"));
const Eventos = require(path.join(RAIZ, "registro-de-eventos.js"));

const PAINEL = fs.readFileSync(path.join(__dirname, "..", "painel-server.js"), "utf8");
const TELA = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");

// ------------------------------------------------- 1. os períodos
{
  const agora = new Date("2026-08-17T12:00:00Z");
  eq(Eventos.periodoPara("mes", agora).desde, "2026-08-01T00:00:00.000Z",
    "1. 'este mês' começa no dia 1º");
  eq(Eventos.periodoPara("30d", agora).desde, "2026-07-18T12:00:00.000Z",
    "1b. '30 dias' anda 30 dias pra trás a partir de agora");
  eq(Eventos.periodoPara("7d", agora).desde, "2026-08-10T12:00:00.000Z", "1c. e '7 dias', sete");
  eq(Eventos.periodoPara("tudo", agora).desde, null, "1d. 'tudo' não corta nada");

  // Não são a mesma coisa, e a diferença aparece justamente no começo do mês: dia 2, o
  // funil "do mês" tem quase nada e o de 30 dias ainda mostra a semana passada.
  const dia2 = new Date("2026-09-02T12:00:00Z");
  ok(Eventos.periodoPara("mes", dia2).desde > Eventos.periodoPara("30d", dia2).desde,
    "1e. no começo do mês, 'este mês' corta mais que '30 dias'");
}

// ------------------------------------------------- 2. o CSV é a planilha, pronta
{
  const t = (m) => new Date(`2026-08-17T12:${String(m).padStart(2, "0")}:00Z`);
  Eventos.registrar("contato", "+55190001", {}, t(0));
  Eventos.registrar("mensagem", "+55190001", { classe: "outro" }, t(0));
  Eventos.registrar("mensagem", "+55190001", { classe: "preco" }, t(1));
  Eventos.registrar("preco_informado", "+55190001", {}, t(2));
  Eventos.registrar("contato", "+55190002", {}, t(3));
  Eventos.registrar("mensagem", "+55190002", { classe: "convenio" }, t(3));

  const linhas = Eventos.csv().split("\n");
  eq(linhas[0], "telefone,primeira_pergunta,primeiro_contato,ultimo_evento,soube_valor,recebeu_horario,agendou,pagou,escalou",
    "2. o cabeçalho tem as colunas que a planilha manual teria");
  eq(linhas.length, 3, "2b. uma linha por contato, não por evento");
  ok(/^\+55190001,preco,/.test(linhas[1]), "2c. com a primeira pergunta já classificada");
  ok(/^\+55190002,convenio,/.test(linhas[2]), "2d. inclusive separando o lead de convênio");
  ok(/,sim,nao,nao,nao,nao$/.test(linhas[1]), "2e. e as etapas como sim/nao, legível em qualquer planilha");
}

// ------------------------------------------------- 3. a rota do CSV não pode ser engolida
{
  // Este é o bug que quase passou: startsWith("/api/funil") casa com "/api/funil.csv", e
  // como a rota do JSON vem primeiro, o download nunca aconteceria.
  ok(!/req\.url\.startsWith\("\/api\/funil"\)/.test(PAINEL),
    "3. a rota do funil NÃO pode usar startsWith, senão engole a do CSV");
  ok(/pathname === "\/api\/funil"/.test(PAINEL), "3b. o JSON compara o caminho exato");
  ok(/pathname === "\/api\/funil\.csv"/.test(PAINEL), "3c. e o CSV também");

  // Prova viva de que os dois caminhos se distinguem.
  const p = (u) => new URL(u, "http://x").pathname;
  ok(p("/api/funil?periodo=mes") !== p("/api/funil.csv?periodo=mes"),
    "3d. e os dois caminhos são de fato diferentes");
}

// ------------------------------------------------- 4. o download é download
{
  ok(/Content-Disposition": `attachment; filename="funil-\$\{periodo\}\.csv"`/.test(PAINEL),
    "4. o CSV desce como arquivo, com o período no nome");
  ok(/"Content-Type": "text\/csv; charset=utf-8"/.test(PAINEL),
    "4b. e com charset, senão acento vira lixo no Excel");
}

// ------------------------------------------------- 5. a lista crua não vai pro navegador
{
  // funil() devolve os contatos um a um. Isso cresce sem teto e a tela não usa: mandar
  // seria despejar o arquivo inteiro na rede a cada atualização.
  ok(/contatos: undefined/.test(PAINEL),
    "5. o endpoint corta a lista de contatos antes de responder");
  ok(/Eventos\.funil\(\{ desde, ate \}\)/.test(PAINEL), "5b. mas usa o mesmo funil() de sempre");
}

// ------------------------------------------------- 6. um número de conversão só
{
  ok(/function renderizarConversao\(f\)/.test(TELA),
    "6. o anel recebe o funil, não mais o objeto de metricas");
  ok(/f && f\.conversaoParticular/.test(TELA),
    "6b. e usa a conversão da base particular, que é o número honesto");
  ok(!/renderizarConversao\(dados\.metricas\)/.test(TELA),
    "6c. a fonte antiga (metricasConversao) não pode continuar alimentando o anel");
  ok(/leads particulares fecharam consulta/.test(TELA),
    "6d. e o texto embaixo do anel diz que a base é particular, senão o número engana");
}

// ------------------------------------------------- 7. a tela existe e não quebra vazia
{
  ok(/id="cartao-funil"/.test(TELA), "7. o cartão está na página");
  ok(/id="funil-corpo"/.test(TELA), "7b. com um lugar pro conteúdo");
  ok(/data-periodo="30d"[^>]*aria-pressed="true"/.test(TELA),
    "7c. abrindo em 30 dias, que é o recorte útil no começo");
  ok(/Ainda não há contatos registrados neste período/.test(TELA),
    "7d. e com texto próprio pra quando não há dado, em vez de barras zeradas");
  ok(/não retroage/.test(TELA),
    "7e. avisando que o funil começa do zero: sem isso parece que o sistema perdeu histórico");
}

// ------------------------------------------------- 8. nada do que vem do dado vira HTML cru
{
  // O rótulo da etapa é nosso, mas o nome da classe de pergunta vem do arquivo de eventos,
  // que é escrito a partir de mensagem de família. Interpolar isso sem escapar é XSS.
  ok(/function esc\(t\)/.test(TELA), "8. existe uma função de escape");
  ok(/esc\(f\.maiorQueda\.de\)/.test(TELA), "8b. usada no texto do gargalo");
  ok(/esc\(NOME_PERGUNTA\[chave\] \|\| chave\)/.test(TELA),
    "8c. e na classe da pergunta, que é o campo que vem do arquivo");
  ok(/encodeURIComponent\(periodoFunil\)/.test(TELA),
    "8d. e o período vai codificado na URL do download");
}

// ------------------------------------------------- 9. o funil não atrapalha o resto
{
  ok(/setInterval\(atualizarFunil, 60000\)/.test(TELA),
    "9. atualiza a cada minuto, não junto com o resto: lê um arquivo que só cresce");
  ok(/\/\/ silencioso: o funil é observação, não pode derrubar o resto do painel/.test(TELA),
    "9b. e o erro dele não derruba a tela");
}

console.log(`\naba-do-funil: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
