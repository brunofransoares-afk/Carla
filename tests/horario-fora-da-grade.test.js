/*
 * Bateria do horário que a agenda não tem.
 *
 * Duas famílias pediram 17h. As duas foram embora.
 *
 * A primeira (05/08, 15:06 às 15:07): a Carla ofereceu alternativa quatro vezes, a mãe disse
 * "Não", e o Dr. Bruno teve que entrar à mão 15 minutos depois pra oferecer as 17h de sexta.
 * Ou seja: ELE CONSEGUE atender às 17h. O que não existe é slot de 17h na grade.
 *
 * A segunda (10/08, 22:59 às 23:19) foi pior. Ela escreveu: "Confirmei aqui, o mais tarde que
 * a agenda dele abre é às 14h, NÃO TRABALHA COM HORÁRIO DE 17H". Isso é falso, e fecha a porta
 * de vez: o pai agradeceu e saiu. Agenda vazia num horário não quer dizer que o médico não
 * possa atender ali.
 *
 * A CAUSA ERA DE PROJETO, não de conversa. Faltavam três coisas ao mesmo tempo:
 *   1. nenhuma regra ligava "pediram horário que não existe" a escalar_humano;
 *   2. ela não tem ferramenta pra abrir horário (quem abre é o painel);
 *   3. a regra do AJUSTE DE HORÁRIO proibia, por escrito, a única saída que funcionava:
 *      prometer "vou perguntar pro doutor".
 *
 * A proibição do item 3 nasceu certa, mas pro caso dela: dentro dos 30 minutos a ferramenta
 * já respondeu, e prometer consulta ao médico ali é enrolação. Fora da grade é o oposto.
 * Por isso ela agora está escopada, e não apagada.
 *
 * Roda com:  node tests/horario-fora-da-grade.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const CEREBRO = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
const PROMPT = CEREBRO.slice(CEREBRO.indexOf("const PROMPT_ESTAVEL = `"), CEREBRO.indexOf("function montarSystemPrompt("));
const SEM_COMENTARIO = PROMPT.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// ------------------------------------------------- 1. a regra existe e escala
{
  ok(/HORÁRIO QUE A AGENDA NÃO TEM:/.test(SEM_COMENTARIO), "1. a regra existe");
  ok(/chame escalar_humano com o motivo dizendo o horário pedido/.test(SEM_COMENTARIO),
    "1b. e termina em escalar_humano, que é o que faz o pedido chegar no painel");
  ok(/vou confirmar com o Dr\. Bruno se ele consegue te atender às 17h e já te retorno por aqui/.test(SEM_COMENTARIO),
    "1c. com um exemplo de tom, porque regra sem exemplo ela não segue");
}

// ------------------------------------------------- 2. ela NUNCA afirma a rotina dele
{
  // Este é o defeito que apareceu no print de 10/08 e é o mais grave dos dois: não é só
  // perder a consulta, é dar informação errada sobre o médico.
  ok(/NUNCA FAZ AQUI: dizer que o Dr\. Bruno "não atende nesse horário"/.test(SEM_COMENTARIO),
    "2. a proibição de afirmar a rotina dele está escrita");
  ok(/agenda vazia num horário não quer dizer que ele não possa atender ali/.test(SEM_COMENTARIO),
    "2b. e explica o porquê, que é o que faz a regra pegar");
  ok(/ele já abriu horário fora da grade pra família que precisava/.test(SEM_COMENTARIO),
    "2c. com o fato que prova: ele já fez isso");
}

// ------------------------------------------------- 3. para de insistir
{
  // Quatro ofertas seguidas foi o que aconteceu no primeiro caso. A terceira já é insistência.
  ok(/Ofereça alternativa UMA vez/.test(SEM_COMENTARIO), "3. uma alternativa, não quatro");
  ok(/pare de oferecer outras opções/.test(SEM_COMENTARIO), "3b. e para quando a família repete o pedido");
  ok(/não fique oferecendo horário depois de escalar/.test(SEM_COMENTARIO),
    "3c. nem depois de escalar, senão a escalada vira enfeite");
}

// ------------------------------------------------- 4. não promete o que não pode
{
  ok(/NÃO prometa que ele vai conseguir/.test(SEM_COMENTARIO),
    "4. levar o pedido não é aprovar o pedido");
  ok(/Você está levando o pedido, não aprovando/.test(SEM_COMENTARIO), "4b. dito com todas as letras");
}

// ------------------------------------------------- 5. a proibição antiga foi escopada, não apagada
{
  // Dentro dos 30 minutos a ferramenta já decidiu, e prometer consulta ao médico ali é
  // enrolação. A proibição continua valendo LÁ, e só lá.
  ok(/dentro dos 30 minutos, não prometa "vou perguntar pro doutor"/.test(SEM_COMENTARIO),
    "5. a proibição continua existindo, agora dizendo onde vale");
  ok(/a ferramenta já respondeu, e a resposta dela é a do consultório/.test(SEM_COMENTARIO),
    "5b. com o motivo, pra ninguém apagar achando que é sobra");
  ok(/Horário MUITO fora da grade é outra conversa e tem regra própria/.test(SEM_COMENTARIO),
    "5c. e aponta pra regra nova, senão as duas brigam e ela inventa uma terceira coisa");

  // A versão antiga era geral e proibia a saída certa em qualquer caso. Não pode voltar.
  ok(!/nunca insista ou prometa "vou perguntar pro doutor"\./.test(SEM_COMENTARIO),
    "5d. a proibição geral, sem escopo, não pode existir mais");
}

// ------------------------------------------------- 6. a regra fica perto de quem ela conversa
{
  // A do ajuste de 30 min e a de fora da grade tratam do mesmo pedido da família ("quero
  // esse horário"), e a diferença entre elas é só a distância. Longe uma da outra, ela lê
  // uma e não a outra.
  const posAjuste = SEM_COMENTARIO.indexOf("AJUSTE DE HORÁRIO (até 30 minutos)");
  const posFora = SEM_COMENTARIO.indexOf("HORÁRIO QUE A AGENDA NÃO TEM:");
  ok(posAjuste > 0 && posFora > posAjuste, "6. a regra nova vem logo depois da do ajuste");
  ok(posFora - posAjuste < 3000, "6b. e perto, não a 40 KB de distância");
}

// ------------------------------------------------- 7. o resto do agendamento não mudou
{
  ok(/AGENDAMENTO: assim que souber o motivo da consulta, chame consultar_horarios IMEDIATAMENTE/.test(SEM_COMENTARIO),
    "7. a regra de oferecer horário direto continua");
  ok(/Ofereça no máximo 2 opções por vez/.test(SEM_COMENTARIO), "7b. duas opções por vez continua");
  ok(/Use o parâmetro horarioAjustado em confirmar_agendamento/.test(SEM_COMENTARIO),
    "7c. o ajuste de 30 minutos continua funcionando");
  ok(/vou confirmar isso com o Dr\. Bruno e já te retorno por aqui/.test(SEM_COMENTARIO),
    "7d. e a fala padrão da escalada continua a mesma, pro sistema falar uma coisa só");
}

console.log(`\nhorario-fora-da-grade: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
