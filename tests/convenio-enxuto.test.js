/*
 * A família perguntou sobre atendimento pelo plano e recebeu um texto inteiro sobre forma
 * de pagamento, nota fiscal, quem pede reembolso e regras do convênio. A resposta precisa
 * informar que o atendimento é particular e seguir, sem transformar a nota numa explicação.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const fonte = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
const inicio = fonte.indexOf("- CONVÊNIO OU REEMBOLSO:");
const fim = fonte.indexOf("- PERGUNTA SOBRE O DR. BRUNO EM OUTRO LUGAR", inicio);
const regra = fonte.slice(inicio, fim);

let passou = 0, falhou = 0;
const erros = [];
function ok(condicao, mensagem) {
  if (condicao) passou++;
  else { falhou++; erros.push(mensagem); }
}

ok(inicio >= 0 && fim > inicio, "1. faltou uma regra única para convênio e reembolso");
ok(/NO MÁXIMO 3 frases curtas, sem explicação/.test(regra),
  "2. a resposta voltou a ficar sem limite de tamanho");
ok(/O atendimento do Dr\. Bruno é particular\. Ele emite nota fiscal\. Quer que eu veja um horário\?/.test(regra),
  "3. faltou a resposta curta para convênio");
ok(/O atendimento do Dr\. Bruno é particular\. Ele emite nota fiscal; confirme diretamente com o seu plano se há reembolso\./.test(regra),
  "4. faltou a resposta curta para reembolso");
ok(/O valor só entra se também perguntarem o preço/.test(regra),
  "5. perguntar apenas convênio voltou a disparar preço e outras informações");
ok(/Este bloco substitui a REGRA SOBRE PREÇO e a regra de formas de pagamento nesta resposta/.test(regra),
  "5b. preço junto com convênio ainda dispara descrição, Pix e cartão");
ok(/Não fale de Pix, cartão, pagamento antecipado, como pedir o reembolso nem das regras do convênio/.test(regra),
  "6. a regra ainda permite repetir a explicação longa do print");
ok(/Mencione a nota fiscal UMA VEZ e siga/.test(regra),
  "7. faltou impedir que a nota fiscal domine a resposta");
ok(!/Com essa nota em mãos|quem pede o reembolso|não tenho como garantir/.test(regra),
  "8. o roteiro longo do print entrou no cérebro");
ok(regra.length < 1050, "9. a correção empilhou regras em vez de simplificar o bloco");
ok(/Só peça os dados quando a família pedir a EMISSÃO da nota; perguntar sobre convênio ou reembolso não é pedido de emissão/.test(fonte),
  "10. pergunta sobre reembolso ainda pode disparar coleta de CPF, CEP e e-mail");
ok(/- O atendimento é particular\./.test(fonte),
  "11. o fato principal precisa ser dito pelo positivo, sem abrir com uma negativa");

console.log(`convenio-enxuto: ${passou} passaram, ${falhou} falharam`);
if (falhou) {
  erros.forEach((erro) => console.log("  FALHOU: " + erro));
  process.exit(1);
}
