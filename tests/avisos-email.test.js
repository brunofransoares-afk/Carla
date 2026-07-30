/*
 * Bateria do e-mail dos avisos de liberação (portal e guia): de onde ele sai e quando recusar.
 *
 * O QUE ISTO GUARDA, em uma frase: as duas mensagens DIZEM à família com qual e-mail criar
 * a senha, então mensagem sem e-mail não é mensagem — é promessa de acesso que a família
 * não consegue usar.
 *
 * Dois defeitos reais moram aqui:
 *
 *   1. O guia recusava com "Agendamento sem e-mail do responsável" um paciente cujo
 *      cadastro no prontuário TINHA e-mail. Causa: a família marcou a consulta sem informar
 *      e-mail, o médico preencheu depois no cadastro, e a correção não chegava até cá — o
 *      pedido do SPI mandava só o telefone. O e-mail do PEDIDO é o caminho dessa correção,
 *      e é por isso que ele tem de ser aceito.
 *
 *   2. O portal não tinha trava de e-mail nenhuma, e o texto interpola o endereço direto.
 *      Sem e-mail a família recebia, no WhatsApp, a linha "usando este mesmo e-mail:
 *      undefined". Ela tenta, não consegue, e conclui que o portal não funciona.
 *
 * OS TEXTOS DAS MENSAGENS NÃO ESTÃO AQUI, e isso é decisão, não esquecimento: eles são
 * escritos à mão pelo Dr. Bruno e continuam no server.js, onde ele mexe. Este módulo é só a
 * decisão do e-mail — a que estava errada.
 *
 * Roda com:  node tests/avisos-email.test.js
 * (o módulo é puro de propósito: o server.js só carrega com a conexão do WhatsApp de pé
 *  e com o diretório irmão carla-app presente, e por isso estas decisões nunca eram testadas)
 */
"use strict";
const path = require("path");
const Avisos = require(path.join(__dirname, "..", "avisos-email.js"));

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const TEL = "+5519999482403";
const AG = (extra) => Object.assign({ slotId: "s1", telefone: TEL, crianca: "Ana" }, extra || {});
const BASE = { endereco: "https://portal.exemplo.com", nomeDaVariavel: "PORTAL_URL", conectado: true };

// ---- 1. e-mail do agendamento manda: foi a própria família que o digitou na conversa
{
  eq(Avisos.emailDoAviso(AG({ responsavelEmail: "mae@exemplo.com" }), "outro@exemplo.com"),
    "mae@exemplo.com",
    "1: preferiu o e-mail do pedido ao do agendamento — o do agendamento veio da família");
}

// ---- 2. sem e-mail no agendamento, o do PEDIDO entra
//
// É o caso 1 do cabeçalho: marcou sem e-mail, o médico preencheu no cadastro depois.
{
  eq(Avisos.emailDoAviso(AG({ responsavelEmail: null }), "mae@exemplo.com"), "mae@exemplo.com",
    "2: ignorou o e-mail do pedido. É por ele que a correção feita no cadastro chega aqui — " +
    "sem isso a Carla recusa por falta de um dado que o sistema já tem");
  eq(Avisos.emailDoAviso(AG({ responsavelEmail: "   " }), "mae@exemplo.com"), "mae@exemplo.com",
    "2b: e-mail só com espaços passou por preenchido");
}

// ---- 3. espaços não viram e-mail, nem de um lado nem do outro
{
  eq(Avisos.emailDoAviso(AG({ responsavelEmail: "  mae@exemplo.com  " }), ""), "mae@exemplo.com",
    "3: não tirou os espaços — e-mail com espaço quebra o convite de criar senha");
  eq(Avisos.emailDoAviso(AG(), "  "), "", "3b: espaço em branco virou e-mail");
  eq(Avisos.emailDoAviso(null, undefined), "", "3c: agendamento ausente não devolveu vazio");
}

// ---- 4. sem e-mail em lugar nenhum: RECUSA, e é o cenário do defeito 2
{
  const r = Avisos.checarAviso(Object.assign({}, BASE, { agendamento: AG(), email: null }));
  eq(r.ok, false, "4: deixou passar aviso sem e-mail. O texto sairia com “undefined” no " +
    "lugar do endereço, e a família concluiria que o acesso não funciona");
  ok(/e-mail/i.test(r.motivo || ""), "4: o motivo não fala de e-mail — " + r.motivo);
}

// ---- 5. com e-mail: passa, e devolve JÁ resolvido
//
// Devolver o e-mail escolhido é o que impede quem chama de recalcular a preferência por
// conta própria e divergir — foi assim que portal e guia se separaram na primeira vez.
{
  const r = Avisos.checarAviso(Object.assign({}, BASE,
    { agendamento: AG({ responsavelEmail: "mae@exemplo.com" }), email: null }));
  eq(r.ok, true, "5: recusou um aviso completo — " + r.motivo);
  eq(r.email, "mae@exemplo.com", "5: não devolveu o e-mail resolvido");
}

// ---- 6. a ordem das travas: endereço, conexão, agendamento, telefone, e-mail
//
// A ordem não é estética. Sem endereço não há o que mandar, e é inútil (e confuso)
// reclamar de e-mail para quem esqueceu de configurar a variável no servidor.
{
  const semEndereco = Avisos.checarAviso({ endereco: "", nomeDaVariavel: "GUIA_URL",
    conectado: false, agendamento: null, email: null });
  ok(/GUIA_URL/.test(semEndereco.motivo || ""),
    "6: com tudo faltando, reclamou de outra coisa antes da variável ausente — " + semEndereco.motivo);

  const desconectada = Avisos.checarAviso({ endereco: "https://x", nomeDaVariavel: "GUIA_URL",
    conectado: false, agendamento: null, email: null });
  ok(/desconectada/i.test(desconectada.motivo || ""),
    "6b: não avisou que a Carla está fora do WhatsApp — " + desconectada.motivo);

  const semAgendamento = Avisos.checarAviso(Object.assign({}, BASE,
    { agendamento: null, email: "mae@exemplo.com" }));
  ok(/agendamento/i.test(semAgendamento.motivo || ""),
    "6c: não disse que não achou o agendamento — " + semAgendamento.motivo);
}

// ---- 7. telefone que não é WhatsApp: recusa antes de tentar mandar
//
// "(a confirmar)" de agendamento feito na mão não é um número; enviar ali estoura no bot.
{
  for (const tel of ["(a confirmar)", "31 99999-0000", "", null]) {
    const r = Avisos.checarAviso(Object.assign({}, BASE,
      { agendamento: AG({ telefone: tel, responsavelEmail: "mae@exemplo.com" }) }));
    eq(r.ok, false, "7: aceitou telefone “" + tel + "” como WhatsApp");
    ok(/telefone/i.test(r.motivo || ""), "7b: o motivo de “" + tel + "” não fala de telefone");
  }
  const bom = Avisos.checarAviso(Object.assign({}, BASE,
    { agendamento: AG({ responsavelEmail: "mae@exemplo.com" }) }));
  eq(bom.ok, true, "7c: recusou um telefone internacional válido — " + bom.motivo);
}

if (falhou) {
  console.log("avisos-email: " + passou + " passaram, " + falhou + " falharam");
  erros.forEach((e) => console.log("  FALHOU: " + e));
  process.exit(1);
}
console.log("avisos-email: " + passou + " passaram, 0 falharam");
