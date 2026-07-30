/*
 * De onde sai o e-mail dos avisos de liberação (portal e guia).
 *
 * NÃO MEXE NOS TEXTOS. As duas mensagens continuam onde sempre estiveram, no server.js,
 * escritas à mão pelo Dr. Bruno — este módulo cuida só de UMA decisão, que é a que estava
 * errada: qual e-mail usar, e quando recusar por não haver nenhum.
 *
 * POR QUE ISSO É UM MÓDULO: o server.js só carrega com a conexão do WhatsApp de pé e com o
 * diretório irmão carla-app presente. Ou seja, a decisão mais delicada das duas mensagens
 * não tinha como ser testada. Aqui ela é pura: entra objeto, sai e-mail ou motivo.
 *
 * A TRAVA QUE IMPORTA: as duas mensagens DIZEM à família com qual e-mail criar a senha.
 * Sem e-mail não existe mensagem possível — o texto sairia prometendo um acesso que a
 * família não consegue usar, ou com a palavra "undefined" no lugar do endereço. Era o caso
 * do portal, que não checava nada; só o guia checava.
 *
 * O e-mail pode vir de dois lugares e a ordem não é arbitrária:
 *   1. o AGENDAMENTO, quando a família informou o e-mail à Carla na marcação;
 *   2. o PEDIDO, quando o médico preencheu o e-mail no cadastro do paciente depois.
 * O caso 2 existe porque marcar consulta sem e-mail é comum, e a correção feita no
 * prontuário precisa chegar até aqui — senão a Carla recusa por falta de um dado que o
 * sistema já tem.
 */
"use strict";

// Prefere o do agendamento: foi a própria família que o digitou na conversa. O do pedido
// entra quando o agendamento não tem — é a correção vinda do cadastro.
function emailDoAviso(agendamento, emailDoPedido) {
  const doAgendamento = String((agendamento && agendamento.responsavelEmail) || "").trim();
  if (doAgendamento) return doAgendamento;
  return String(emailDoPedido || "").trim();
}

// Travas comuns aos dois avisos, na mesma ordem, porque os dois falham do mesmo jeito.
// Devolve { ok: false, motivo } ou { ok: true, email } — com o e-mail JÁ resolvido, para
// quem chama não recalcular a preferência por conta própria e divergir. Foi calculando
// separado que portal e guia se afastaram na primeira vez.
function checarAviso({ endereco, nomeDaVariavel, conectado, agendamento, email }) {
  if (!String(endereco || "").trim()) {
    // A ordem não é estética: sem endereço não há o que mandar, e é inútil reclamar de
    // e-mail para quem esqueceu de configurar a variável no servidor.
    return { ok: false, motivo: nomeDaVariavel + " não configurada" };
  }
  if (!conectado) return { ok: false, motivo: "Carla desconectada do WhatsApp" };
  if (!agendamento) return { ok: false, motivo: "Não achei agendamento pra esse telefone/e-mail" };
  // Placeholders tipo "(a confirmar)", de agendamento feito na mão, não são um WhatsApp.
  if (!String((agendamento && agendamento.telefone) || "").startsWith("+")) {
    return { ok: false, motivo: "Agendamento sem telefone de WhatsApp válido" };
  }
  const emailFinal = emailDoAviso(agendamento, email);
  if (!emailFinal) return { ok: false, motivo: "Agendamento sem e-mail do responsável" };
  return { ok: true, email: emailFinal };
}

module.exports = { emailDoAviso, checarAviso };
