/*
 * Bateria da porta de máquina do painel (prontuário -> Carla).
 *
 * Esta é a rota que fica ANTES da senha do painel. Se ela abrir para quem não deve, qualquer
 * um na internet faz a Carla mandar mensagem para as famílias do consultório. É o único
 * lugar do painel onde a autorização não é a senha, então é o que mais precisa de teste.
 *
 * Roda sem subir servidor e sem a pasta irmã carla-app — de propósito. As baterias que
 * dependem dela (portal-liberado, guia-liberado) não rodam em ambiente de desenvolvimento
 * nenhum além da VPS, e uma regra de segurança que só é testada na VPS é uma regra que na
 * prática não é testada.
 *
 * Uso: node tests/painel-webhook.test.js
 */
const path = require("path");
const { decidir } = require(path.join(__dirname, "..", "painel-webhook.js"));

let passaram = 0;
const falhas = [];
function eq(a, b, msg) {
  if (a === b) passaram++;
  else falhas.push(msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")");
}
function ok(c, msg) { if (c) passaram++; else falhas.push(msg); }
// Ler o motivo sem estourar. Descoberto num teste de mutação: quando a decisão passa a ser
// "encaminhar", `corpo` não existe, e ler `.motivo` direto derrubava a bateria inteira no
// meio — o que ESCONDIA as outras falhas da mesma mutação. Um teste que quebra vale menos
// que um teste que falha, porque a lista de falhas é o diagnóstico.
function motivoDe(d) { return String((d && d.corpo && d.corpo.motivo) || ""); }

const SEGREDO = "segredo-do-painel";
const COMPARTILHADO = "segredo-que-a-carla-usa-com-o-spi";
const POST = { url: "/webhook/portal-liberado", method: "POST" };

// ---- 1. o caminho que tem que funcionar, com o segredo dedicado
{
  const d = decidir({ ...POST, headers: { "x-carla-secret": SEGREDO },
    env: { PORTAL_WEBHOOK_SECRET: SEGREDO } });
  eq(d.tipo, "encaminhar", "1: recusou o pedido legítimo do portal");
  eq(d.caminho, "/interno/portal-liberado", "1: encaminhou para a porta interna errada");
}

// ---- 2. o guia vai para OUTRA porta interna
//
// Os dois avisos são momentos diferentes da vida da família: o portal quando marca a
// consulta, o guia quando paga. Trocar os caminhos mandaria a mensagem errada na hora
// errada — e a família receberia "seu guia está liberado" sem ter pago.
{
  const d = decidir({ url: "/webhook/guia-liberado", method: "POST",
    headers: { "x-carla-secret": SEGREDO }, env: { PORTAL_WEBHOOK_SECRET: SEGREDO } });
  eq(d.tipo, "encaminhar", "2: recusou o pedido legítimo do guia");
  eq(d.caminho, "/interno/guia-liberado", "2: mandou o aviso do guia para a porta do portal");
}

// ---- 3. o segredo compartilhado com o SPI serve como reserva
//
// Existe para a integração funcionar sem ninguém precisar criar variável nova na VPS.
{
  const d = decidir({ ...POST, headers: { "x-carla-secret": COMPARTILHADO },
    env: { APP_CARLA_SECRET: COMPARTILHADO } });
  eq(d.tipo, "encaminhar", "3: não aceitou o segredo que a Carla já compartilha com o SPI");
}

// ---- 4. segredo errado NÃO entra, mesmo com os dois configurados
{
  const d = decidir({ ...POST, headers: { "x-carla-secret": "chute" },
    env: { PORTAL_WEBHOOK_SECRET: SEGREDO, APP_CARLA_SECRET: COMPARTILHADO } });
  eq(d.tipo, "recusar", "4: DEIXOU ENTRAR com segredo errado");
  eq(d.status, 401, "4: status errado para segredo errado");
  ok(/mesmo do \.env/.test(motivoDe(d)),
    "4: o motivo não diz o que conferir; sobraria adivinhar de novo");
}

// ---- 5. sem cabeçalho nenhum: 401, e o motivo é OUTRO
//
// "Faltou o cabeçalho" e "o segredo não confere" são defeitos diferentes, com consertos
// diferentes. Uma mensagem só para os dois manda procurar no lugar errado.
{
  const d = decidir({ ...POST, headers: {}, env: { PORTAL_WEBHOOK_SECRET: SEGREDO } });
  eq(d.tipo, "recusar", "5: aceitou pedido sem segredo");
  eq(d.status, 401, "5: status errado");
  ok(/falta o cabeçalho/i.test(motivoDe(d)), "5: confundiu ausência com divergência");
}

// ---- 6. NADA configurado: a porta fecha, e diz QUAL variável preencher
//
// Este é o cenário que custou uma noite: um 401 sem motivo fez procurar problema no login
// do médico, que estava certo. Configuração ausente tem de se anunciar.
{
  const d = decidir({ ...POST, headers: { "x-carla-secret": SEGREDO }, env: {} });
  eq(d.tipo, "recusar", "6: porta aberta sem segredo configurado — qualquer um mandaria msg");
  eq(d.status, 503, "6: 401 diz 'sua credencial está errada'; o certo aqui é 503, falta config");
  ok(/PORTAL_WEBHOOK_SECRET/.test(motivoDe(d)) && /APP_CARLA_SECRET/.test(motivoDe(d)),
    "6: não nomeou as variáveis a preencher");
  ok(/reinicie/.test(motivoDe(d)),
    "6: não lembra do restart; preencher o .env sem reiniciar não muda nada e parece que falhou de novo");
}

// ---- 7. segredo vazio no ambiente não vale como segredo
//
// PORTAL_WEBHOOK_SECRET="" com um cabeçalho vazio bateria como igual numa comparação
// ingênua, e a porta abriria para quem não mandasse nada.
{
  const d = decidir({ ...POST, headers: { "x-carla-secret": "" },
    env: { PORTAL_WEBHOOK_SECRET: "", APP_CARLA_SECRET: "" } });
  eq(d.tipo, "recusar", "7: string vazia virou credencial válida");
  eq(d.status, 503, "7: deveria tratar como não configurado");
}

// ---- 8. espaço em branco em volta não derruba o pedido
//
// O valor é colado à mão nos dois lados. Um "\n" invisível no fim já custou uma tarde
// neste projeto, e o teste do lado do cabeçalho passava sem o trim.
{
  const d = decidir({ ...POST, headers: { "x-carla-secret": "  " + SEGREDO + "\n" },
    env: { PORTAL_WEBHOOK_SECRET: SEGREDO + "\n\n" } });
  eq(d.tipo, "encaminhar", "8: um \\n invisível derrubou um pedido legítimo");
}

// ---- 9. GET não é pedido de aviso
//
// Preview de link e varredura abrem URL com GET. Cair na senha do painel aqui esconderia
// o que está acontecendo; 405 é honesto.
{
  const d = decidir({ url: "/webhook/portal-liberado", method: "GET",
    headers: { "x-carla-secret": SEGREDO }, env: { PORTAL_WEBHOOK_SECRET: SEGREDO } });
  eq(d.tipo, "recusar", "9: aceitou GET");
  eq(d.status, 405, "9: status errado para método errado");
}

// ---- 10. qualquer outra URL é IGNORADA, não recusada
//
// A diferença é o painel inteiro: se esta função "recusasse" o desconhecido, o dashboard,
// os ícones e as /api parariam de responder.
{
  for (const url of ["/", "/api/dados", "/icons/x.png", "/webhook/outra-coisa"]) {
    const d = decidir({ url, method: "POST", headers: {}, env: { PORTAL_WEBHOOK_SECRET: SEGREDO } });
    eq(d.tipo, "ignorar", "10: sequestrou " + url + " — o painel pararia de funcionar");
  }
}

// ---- 11. query string não engana o roteamento
{
  const d = decidir({ url: "/webhook/guia-liberado?origem=prontuario", method: "POST",
    headers: { "x-carla-secret": SEGREDO }, env: { PORTAL_WEBHOOK_SECRET: SEGREDO } });
  eq(d.tipo, "encaminhar", "11: query string fez a rota deixar de ser reconhecida");
  eq(d.caminho, "/interno/guia-liberado", "11: caminho interno errado");
}

// ---- 12. nunca lança, nem com entrada esdrúxula
{
  for (const entrada of [{}, { url: null }, { url: "/webhook/guia-liberado" },
                         { url: "/webhook/guia-liberado", method: "POST" }]) {
    let lancou = false;
    try { decidir(entrada); } catch (e) { lancou = true; }
    ok(!lancou, "12: lançou com entrada " + JSON.stringify(entrada) +
      " — uma exceção aqui derruba a resposta e o navegador vê 'falha de rede'");
  }
}

if (falhas.length) {
  console.log("painel-webhook: " + falhas.length + " falha(s)");
  falhas.forEach((f) => console.log("  FALHOU: " + f));
  process.exit(1);
}
console.log("painel-webhook: " + passaram + " passaram, 0 falharam");
