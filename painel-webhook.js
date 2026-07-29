/*
 * A PORTA DE MÁQUINA do painel: como o prontuário (SPI) pede à Carla que avise a família.
 *
 * Por que isto existe separado do painel-server.js: aqui mora a decisão de AUTORIZAÇÃO, e
 * painel-server.js sobe um servidor ao ser carregado — não dá para testar sem abrir porta.
 * A regra de quem entra é a coisa deste projeto que menos pode ficar sem teste, então ela
 * virou um módulo puro: entra (url, método, cabeçalhos, ambiente), sai a decisão.
 *
 * As duas rotas ficam ANTES da checagem de senha do painel de propósito: quem chama é
 * máquina (uma Edge Function do SPI), não navegador. Ela se identifica pelo segredo
 * combinado. Nenhuma senha de painel existe em código nem em variável do SPI.
 *
 * DOIS AVISOS, DOIS CAMINHOS, e é intencional que não sejam um só: o do portal sai quando a
 * consulta é marcada, o do guia quando a família paga. São momentos diferentes na vida da
 * família, e juntá-los num "avisar" genérico faria um dos dois sair na hora errada.
 */

// O segredo aceito. Dois nomes, e a ordem importa:
//
//   PORTAL_WEBHOOK_SECRET — o dedicado a esta porta. É o preferido.
//   APP_CARLA_SECRET      — o que a Carla JÁ usa para falar com o SPI (mandado como
//                           X-Carla-Secret na outra direção). Aceito como reserva porque
//                           é o mesmo par de partes conversando, e assim a integração
//                           funciona sem ninguém precisar criar variável nova.
//
// O custo dessa reserva, dito por extenso: reusar um segredo nas duas direções significa
// que vazar um lado vaza o outro. Como as duas pontas são as mesmas (SPI e Carla) e o SPI
// já guarda esse valor, não há nada a mais exposto. Mas se algum dia entrar um terceiro
// falando com o painel, o certo é preencher PORTAL_WEBHOOK_SECRET e parar de aceitar a
// reserva.
function segredosAceitos(env) {
  const lista = [];
  const dedicado = String(env.PORTAL_WEBHOOK_SECRET || "").trim();
  const compartilhado = String(env.APP_CARLA_SECRET || "").trim();
  if (dedicado) lista.push({ nome: "PORTAL_WEBHOOK_SECRET", valor: dedicado });
  if (compartilhado) lista.push({ nome: "APP_CARLA_SECRET", valor: compartilhado });
  return lista;
}

// url -> caminho da porta interna do bot. Só estes dois; qualquer outro cai fora.
const ROTAS = {
  "/webhook/portal-liberado": "/interno/portal-liberado",
  "/webhook/guia-liberado": "/interno/guia-liberado",
};

/*
 * Decide o que fazer com um pedido. Nunca lança.
 *
 * Devolve:
 *   { tipo: "ignorar" }                    -> não é uma rota desta porta; siga o fluxo normal
 *   { tipo: "recusar", status, corpo }      -> responda isso e pare
 *   { tipo: "encaminhar", caminho }         -> mande o corpo para essa porta interna do bot
 */
function decidir({ url, method, headers, env }) {
  const caminhoInterno = ROTAS[String(url || "").split("?")[0]];
  if (!caminhoInterno) return { tipo: "ignorar" };
  // Só POST. Um GET nesta URL não é um pedido de aviso — é alguém explorando, ou um
  // preview de link abrindo a URL. Responder 405 em vez de cair na senha deixa isso claro.
  if (String(method || "").toUpperCase() !== "POST") {
    return { tipo: "recusar", status: 405, corpo: { ok: false, motivo: "use POST" } };
  }

  const aceitos = segredosAceitos(env || {});
  if (!aceitos.length) {
    // ESTA MENSAGEM É O PRODUTO. A versão anterior devolvia só "não autorizado", e uma
    // noite inteira se passou procurando um login errado por causa de um 401 sem motivo.
    // Falta de configuração e segredo errado são problemas diferentes e a resposta diz qual.
    return { tipo: "recusar", status: 503, corpo: { ok: false,
      motivo: "porta fechada: preencha PORTAL_WEBHOOK_SECRET (ou APP_CARLA_SECRET) no .env " +
        "do servidor da Carla e reinicie o painel" } };
  }

  const enviado = String(
    (headers && (headers["x-carla-secret"] || headers["X-Carla-Secret"])) || ""
  ).trim();
  if (!enviado) {
    return { tipo: "recusar", status: 401, corpo: { ok: false,
      motivo: "falta o cabeçalho X-Carla-Secret" } };
  }
  // Comparação com trim nos DOIS lados: o valor do SPI é colado à mão no painel do
  // Supabase, e um "\n" invisível no fim já custou uma tarde neste projeto.
  if (!aceitos.some((s) => s.valor === enviado)) {
    return { tipo: "recusar", status: 401, corpo: { ok: false,
      motivo: "segredo não confere com nenhum dos configurados aqui — confira se o valor " +
        "no SPI é o mesmo do .env da Carla" } };
  }

  return { tipo: "encaminhar", caminho: caminhoInterno };
}

module.exports = { decidir, ROTAS };
