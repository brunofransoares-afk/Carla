/*
 * Textos e travas dos dois avisos de liberação (portal e guia).
 *
 * POR QUE ISTO É UM MÓDULO SEPARADO: as duas mensagens vivem dentro do server.js, que só
 * carrega com a conexão do WhatsApp de pé e com o diretório irmão carla-app presente. Ou
 * seja: a decisão mais delicada das duas — "tem e-mail para prometer acesso?" — não tinha
 * como ser testada. Aqui ela é pura: entra objeto, sai texto ou motivo de recusa.
 *
 * A TRAVA QUE IMPORTA: as duas mensagens DIZEM à família com qual e-mail criar a senha.
 * Sem e-mail não existe mensagem possível — o texto sairia prometendo um acesso que a
 * família não consegue usar, ou pior, com a palavra "undefined" no lugar do endereço. Era
 * o caso do portal, que não tinha essa trava: só o guia tinha.
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
// Devolve { ok: false, motivo } ou { ok: true, email }.
function checarAviso({ endereco, nomeDaVariavel, conectado, agendamento, email }) {
  if (!String(endereco || "").trim()) {
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

// Neutro quanto ao sexo da criança: este texto é fixo e o sistema não sabe o sexo (quem
// presume é o prontuário, pelo primeiro nome, e erra).
function textoPortal({ endereco, crianca, email }) {
  return [
    `Oi! O Dr. Bruno liberou o portal de ${crianca} 😊`,
    "",
    "É onde fica tudo num lugar só: você guarda os exames, a carteira de vacinação e o peso e altura, e compara os exames antigos com os novos. As receitas e os documentos que o Dr. Bruno passar chegam por lá também, e você acompanha o crescimento e as vacinas que ainda faltam.",
    "",
    endereco,
    "",
    `No primeiro acesso você cria a sua senha, usando este mesmo e-mail: ${email}`,
    "",
    // O passo a passo muda entre iPhone e Android, e a família não vai saber qual é o
    // "menu do navegador" se ninguém disser. Uma linha pra cada, sem virar tutorial.
    "Se quiser deixar como aplicativo no celular: abra o link, toque no menu do navegador e escolha \"Adicionar à Tela de Início\". No iPhone o menu é o ícone de compartilhar; no Android, os três pontinhos.",
  ].join("\n");
}

// O guia é produto pago: esta mensagem só sai por um toque do Dr. Bruno, DEPOIS de ele já
// ter liberado o acesso no prontuário. A Carla nunca oferece o guia por conta própria.
function textoGuia({ endereco, email }) {
  return [
    // Texto do Dr. Bruno, palavra por palavra. Fala com a MÃE, não com a criança: o guia
    // serve pra qualquer família, então aqui não entra nome nem sexo de ninguém.
    "Oi! 😊 O Dr. Bruno liberou pra você o Guia Completo de Pediatria, escrito por ele pras famílias que atende.",
    "",
    "São 16 áreas e mais de 100 capítulos, do recém-nascido ao adolescente: febre, tosse, alergia, sono, alimentação, vacinas, pele, desenvolvimento, segurança e primeiros socorros.",
    "",
    "Tem também checador de sintomas (você marca o que está vendo e ele diz se dá pra cuidar em casa ou se é hora de procurar ajuda), um assistente pra tirar dúvidas com base só no conteúdo do guia, e vídeos reais, como o desengasgo passo a passo.",
    "",
    "Instala como app no celular e funciona até sem internet. É seu, não expira. Não substitui a consulta: serve pra você entender e reconhecer a hora certa de procurar ajuda.",
    "",
    `👉 ${endereco}`,
    "",
    `No primeiro acesso você cria sua senha com este e-mail: ${email}`,
    "O link chega por e-mail. Se não achar, olhe no lixo eletrônico. 💛",
    "",
    // Mesma dica da mensagem do portal: o guia também instala na tela inicial, e quem não
    // sabe fazer isso é justamente quem mais ganha com ela.
    "Se quiser deixar como aplicativo no celular: abra o link, toque no menu do navegador e escolha \"Adicionar à Tela de Início\". No iPhone o menu é o ícone de compartilhar; no Android, os três pontinhos.",
  ].join("\n");
}

module.exports = { emailDoAviso, checarAviso, textoPortal, textoGuia };
