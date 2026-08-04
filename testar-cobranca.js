/*
 * SONDA DE UMA VEZ SÓ: descobre o que a API da InfinitePay aceita de verdade.
 *
 * O endereço e o nome do campo dos itens vieram da documentação oficial, dentro do app
 * (Checkout Integrado -> Documentação). A primeira versão deste arquivo usava
 * api.checkout.infinitepay.io/links e "items" em inglês, que era o que as fontes de
 * terceiros diziam. Estava errado nos dois.
 *
 * ISTO NÃO FAZ PARTE DA CARLA. Nem o server.js nem o painel-server.js chamam este arquivo.
 * Ele existe pra ser rodado na mão, uma vez, e responder o que a documentação não responde.
 *
 * POR QUE PRECISA SER RODADO AÍ. A máquina onde eu trabalho bloqueia infinitepay.io por
 * política de rede, então eu não consigo fazer a chamada nem ler a página do link. O
 * servidor da Carla não tem essa limitação.
 *
 * O QUE ELE RESPONDE, e é tudo que falta pra eu escrever a integração:
 *
 *   1. A API aceita chamada só com o handle, sem token? Se responder 401/403, existe uma
 *      chave em algum lugar e a gente vai ter que achar.
 *   2. O link que ela devolve mostra Pix, ou só cartão? (é abrir o link que ela imprimir)
 *   3. Existe campo de validade? A sonda manda quatro nomes possíveis de uma vez. Se a API
 *      reclamar de campo desconhecido, a resposta já diz qual ela conhece; se aceitar
 *      calada, dá pra ver na página se o vencimento apareceu.
 *
 * SEGURANÇA: R$ 1,00, e o link não cobra ninguém sozinho — só existe até alguém abrir e
 * pagar de propósito. Não mexe em nada da sua conta além de criar esse link.
 *
 * COMO RODAR, na pasta da Carla no servidor:
 *
 *     node testar-cobranca.js
 *
 * E me manda o que aparecer, inteiro.
 */
"use strict";

const HANDLE = process.env.INFINITEPAY_HANDLE || "brunoffsoares";
const PAINEL = "https://painel.drbrunosoares.med.br";

// Os quatro nomes plausíveis pro campo de validade, mandados juntos de propósito: se a API
// for do tipo que recusa campo que não conhece, o erro dela nomeia o certo.
const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);
const amanhaISO = amanha.toISOString();
const amanhaData = amanhaISO.slice(0, 10);

const corpo = {
  handle: HANDLE,
  order_nsu: "sonda-" + Date.now(),
  redirect_url: PAINEL + "/",
  webhook_url: PAINEL + "/webhook/infinitepay/sonda",
  itens: [
    // Preço SEMPRE em centavos. 100 = R$ 1,00.
    { quantity: 1, price: 100, description: "Teste de integracao da Carla (R$ 1,00)" },
  ],
  expires_at: amanhaISO,
  expiration_date: amanhaData,
  due_date: amanhaData,
  expires_in: 86400,
};

(async () => {
  console.log("Mandando pra https://api.infinitepay.io/invoices/public/checkout/links");
  console.log("Corpo enviado:\n" + JSON.stringify(corpo, null, 2) + "\n");

  let resposta;
  try {
    resposta = await fetch("https://api.infinitepay.io/invoices/public/checkout/links", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(corpo),
    });
  } catch (erro) {
    console.error("NÃO CONSEGUI NEM CHEGAR NA API:", erro.message);
    console.error("Se for erro de rede, o servidor não está alcançando a internet.");
    process.exit(1);
  }

  const texto = await resposta.text();
  console.log("=".repeat(60));
  console.log("HTTP " + resposta.status + " " + resposta.statusText);
  console.log("=".repeat(60));
  console.log(texto);
  console.log("=".repeat(60));

  if (resposta.status === 401 || resposta.status === 403) {
    console.log("\nLEITURA: precisa de autenticação. Existe uma chave em algum lugar da conta.");
    return;
  }
  if (!resposta.ok) {
    console.log("\nLEITURA: a API recusou. O motivo acima costuma dizer qual campo ela não aceitou.");
    return;
  }

  try {
    const dados = JSON.parse(texto);
    const url = dados.url || dados.link || (dados.data && dados.data.url);
    if (url) {
      console.log("\nABRE ESTE LINK NO CELULAR E ME DIZ:");
      console.log("  " + url);
      console.log("\n  1. aparece Pix junto do cartão?");
      console.log("  2. aparece parcelamento em 3x?");
      console.log("  3. aparece alguma data de vencimento/validade?");
    }
  } catch {
    console.log("\n(a resposta não veio em JSON, mas o texto acima já serve)");
  }
})();
