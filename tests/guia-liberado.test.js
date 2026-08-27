/*
 * Bateria do aviso do guia (as decisões de dados; ver nota abaixo sobre o que não entra).
 *
 * O guia é um PRODUTO PAGO. Isso muda o que pode dar errado:
 *
 *   - mandar duas vezes: a família recebe o mesmo link duas vezes e parece desorganização;
 *   - mandar para quem não foi liberado no prontuário: ela abre, não consegue entrar e
 *     desiste — e a impressão que fica é de que o presente não funciona;
 *   - a marca do guia e a do portal se confundirem: aí enviar um faria o outro sumir do
 *     painel, e uma das duas mensagens nunca sairia.
 *
 * O último é o cenário 3, e é o que justifica as duas marcas serem separadas.
 *
 * O QUE ESTA BATERIA NÃO COBRE, de propósito e igual à do portal: o envio no WhatsApp e as
 * rotas HTTP. Os dois dependem do processo do bot de pé com a conexão viva, e fingir isso
 * testaria a imitação, não o programa.
 *
 * Roda com:  node tests/guia-liberado.test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const RAIZ = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "carla-teste-")), "bot");
fs.mkdirSync(path.join(RAIZ, "data"), { recursive: true });
fs.copyFileSync(path.join(__dirname, "..", "storage-node.js"), path.join(RAIZ, "storage-node.js"));
fs.copyFileSync(path.join(__dirname, "..", "arquivo-atomico.js"), path.join(RAIZ, "arquivo-atomico.js"));
const IRMA = path.join(RAIZ, "carla-app", "js");
fs.mkdirSync(IRMA, { recursive: true });
fs.writeFileSync(path.join(IRMA, "config.js"), "global.CARLA_CONFIG = global.CARLA_CONFIG || {};\n");
fs.writeFileSync(path.join(IRMA, "agenda.js"), "module.exports = {};\n");

const Storage = require(path.join(RAIZ, "storage-node.js"));

const TEL = "+5519999482403";
const TEL2 = "+5519888112233";
const slot = (id, time) => ({ id, date: "2026-09-10", time, label: "10/09 às " + time });

const reservaG1 = Storage.reservar({ slot: slot("g1", "09:00"), responsavel: "Ana", crianca: "Eduardo Ramos", telefone: TEL });
Storage.registrarDadosDoPaciente(TEL, { email: "mae@exemplo.com" });

// ------------------------------------------------- 1. marca o guia como avisado
{
  const antes = Storage.lerAgendamentos().find((a) => a.slotId === reservaG1.slotId);
  ok(!antes.guiaAvisadoEm, "1. nasce sem marca de guia avisado");

  eq(Storage.marcarGuiaAvisado(reservaG1.slotId), true, "1. marcar devolveu true");
  const depois = Storage.lerAgendamentos().find((a) => a.slotId === reservaG1.slotId);
  ok(!!depois.guiaAvisadoEm, "1. gravou guiaAvisadoEm");
  ok(!isNaN(new Date(depois.guiaAvisadoEm).getTime()), "1. a data gravada é válida");
}

// -------------------- 2. slotId que não existe não cria linha nem estoura
{
  const antes = Storage.lerAgendamentos().length;
  eq(Storage.marcarGuiaAvisado("nao-existe"), false, "2. devolveu false para slot inexistente");
  eq(Storage.lerAgendamentos().length, antes, "2. inventou um agendamento");
}

// ==== 3. AS DUAS MARCAS SÃO INDEPENDENTES ====
//
// Se o guia e o portal compartilhassem uma marca só, enviar um faria o botão do outro
// sumir do painel — e uma das duas mensagens nunca sairia, sem ninguém entender por quê.
{
  const reservaG2 = Storage.reservar({ slot: slot("g2", "10:00"), responsavel: "Bia", crianca: "Lis Prado", telefone: TEL2 });
  Storage.registrarDadosDoPaciente(TEL2, { email: "bia@exemplo.com" });

  Storage.marcarPortalAvisado(reservaG2.slotId);
  let item = Storage.lerAgendamentos().find((a) => a.slotId === reservaG2.slotId);
  ok(!!item.portalAvisadoEm, "3. marcou o portal");
  ok(!item.guiaAvisadoEm,
    "3. marcar o PORTAL marcou o guia junto — o botão do guia sumiria e a família nunca receberia o link");

  Storage.marcarGuiaAvisado(reservaG2.slotId);
  item = Storage.lerAgendamentos().find((a) => a.slotId === reservaG2.slotId);
  ok(!!item.guiaAvisadoEm && !!item.portalAvisadoEm, "3. as duas marcas convivem na mesma linha");

  // e o inverso: guia primeiro não pode marcar o portal
  const reservaG3 = Storage.reservar({ slot: slot("g3", "11:00"), responsavel: "Cida", crianca: "Ana Melo", telefone: "+5519777001122" });
  Storage.marcarGuiaAvisado(reservaG3.slotId);
  const outro = Storage.lerAgendamentos().find((a) => a.slotId === reservaG3.slotId);
  ok(!outro.portalAvisadoEm,
    "3. marcar o GUIA marcou o portal junto — o aviso do portal nunca sairia para essa família");
}

// ---- 4. a busca por e-mail (a mesma que o aviso usa) continua servindo aos dois
{
  const a = Storage.acharAgendamentoPorEmail("  MAE@Exemplo.com ");
  ok(a && a.slotId === reservaG1.slotId, "4. acha pelo e-mail com espaço e maiúscula, como digitado à mão");
}

// ---- 5. o e-mail do guia é o MESMO do portal (decisão do Dr. Bruno)
//
// Não existe campo separado. Se um dia existir, este teste falha e obriga a revisar os dois
// avisos juntos, em vez de um passar a usar um endereço que o outro não conhece.
{
  const a = Storage.lerAgendamentos().find((x) => x.slotId === reservaG1.slotId);
  eq(a.responsavelEmail, "mae@exemplo.com",
    "5. o e-mail continua num campo só; se isso mudou, os dois avisos precisam ser revistos juntos");
}

if (falhou) {
  console.log("guia-liberado: " + passou + " passaram, " + falhou + " falharam");
  erros.forEach((e) => console.log("  FALHOU: " + e));
  process.exit(1);
}
console.log("guia-liberado: " + passou + " passaram, 0 falharam");
