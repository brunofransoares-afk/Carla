/*
 * Bateria da trava "só marca o que ofereceu".
 *
 * Caso real do log do servidor, 21:01:15:
 *
 *   confirmar_agendamento({"slotId":"quinta-13/08-08:00","slotLabel":"quinta-feira (13/08) às 8h",...})
 *
 * Os slotId de verdade são assim: 2026-07-30T11:00, 2026-08-06T08:00. Aquele "quinta-13/08
 * -08:00" a Carla inventou, num formato que o sistema nem usa — ela ofereceu à família um
 * horário que nunca consultou. Naquele caso o formato torto denunciou e a reserva foi
 * recusada. Um chute BEM FORMADO, num horário que por acaso existisse e estivesse livre,
 * teria marcado sem ninguém notar.
 *
 * A trava é: só dá pra confirmar slotId que a ferramenta devolveu nesta conversa.
 *
 * Roda com:  node tests/so-marca-o-que-ofereceu.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }

// ------------------------------------------------------------------ 1. o registro
// O registro vive em arquivo próprio, sem dependência, justamente pra a bateria poder
// exercitar a regra sem carregar o SDK da Anthropic e a agenda inteira.
const { anotarOferta } = require(path.join(__dirname, "..", "oferta-de-horarios.js"));

{
  const ctx = { horariosOferecidos: new Set() };
  const devolvido = anotarOferta(ctx, { horarios: [{ slotId: "2026-08-06T08:00", label: "quinta (06/08) às 8h" }] });
  ok(ctx.horariosOferecidos.has("2026-08-06T08:00"), "1. o horário oferecido fica registrado");
  ok(devolvido && devolvido.horarios, "1. devolve o mesmo resultado, pra poder usar no return");
  ok(!ctx.horariosOferecidos.has("quinta-13/08-08:00"), "1. o horário inventado NÃO está registrado");
}

{
  // Duas consultas seguidas na mesma conversa: a segunda não apaga a primeira, porque a
  // família pode escolher o horário que viu duas mensagens atrás.
  const ctx = { horariosOferecidos: new Set() };
  anotarOferta(ctx, { horarios: [{ slotId: "A" }, { slotId: "B" }] });
  anotarOferta(ctx, { horarios: [{ slotId: "C" }] });
  ok(ctx.horariosOferecidos.size === 3, "2. acumula entre consultas, não substitui");
  ok(["A", "B", "C"].every((s) => ctx.horariosOferecidos.has(s)), "2. os três continuam válidos");
}

{
  // "Não há horário livre" volta com horarios: [] — não pode explodir nem registrar nada.
  const ctx = { horariosOferecidos: new Set() };
  anotarOferta(ctx, { horarios: [], aviso: "Não há horário livre." });
  anotarOferta(ctx, { aviso: "sem a chave horarios" });
  anotarOferta(ctx, { horarios: [null, {}, { label: "sem slotId" }] });
  ok(ctx.horariosOferecidos.size === 0, "3. resultado vazio ou torto não registra nada e não quebra");
}

// ------------------------------------------------- 4. nenhum caminho escapa da trava
// A trava só vale se TODO retorno de horários passar pelo registro. Amanhã alguém adiciona
// um quarto caminho em consultar_horarios e a trava fura sem ninguém perceber — então a
// bateria confere isso no código-fonte, não na fé.
{
  const fonte = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
  const escapes = fonte.match(/return\s+(resultado|resultadoUrgente)\s*;/g) || [];
  ok(escapes.length === 0,
    `4. todo retorno de horários passa por anotarOferta (achei ${escapes.length} retorno(s) direto(s): ${escapes.join(", ")})`);

  const registros = (fonte.match(/return anotarOferta\(ctx,/g) || []).length;
  ok(registros >= 3, `4. os três caminhos de consultar_horarios registram (achei ${registros})`);

  ok(/if \(!ctx\.horariosOferecidos\.has\(input\.slotId\)\)/.test(fonte),
    "4. o confirmar_agendamento recusa slotId que não foi oferecido");
}

console.log(erros.map((e) => "  FALHA " + e).join("\n"));
console.log(`so-marca-o-que-ofereceu: ${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
