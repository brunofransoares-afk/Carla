"use strict";

function mensagemDaReserva(acao) {
  const valor = acao.valorDaConsulta || "o valor informado";
  const prazo = acao.prazoPagamento || "no prazo informado";
  return `Perfeito 😊

Deixei separado para você: ${acao.slot.label}.
*O horário fica guardado até o pagamento, que precisa ser feito ${prazo}.*

Endereço: Rua Ranulpho Alvarenga Ferreira, 61

A chave Pix é o e-mail (${valor}):

brunofransoares@gmail.com

Se preferir cartão em até 3x, me avisa que te mando o link.`;
}

function respostaDepoisDosEfeitos(ctx) {
  const acoes = ctx.acoesRealizadas || [];
  const cancelamentos = ctx.cancelamentosRealizados || [];

  if (acoes.length === 1) return mensagemDaReserva(acoes[0]);
  if (acoes.length > 1) {
    const linhas = acoes.map((a) =>
      `• ${a.crianca}: ${a.slot.label}, ${a.valorDaConsulta || "valor informado"}, pagamento ${a.prazoPagamento || "no prazo informado"}`);
    return `Os horários ficaram separados 😊\n\n${linhas.join("\n")}\n\nA chave Pix é brunofransoares@gmail.com. Se preferir cartão, me avisa que te mando o link.`;
  }
  if (cancelamentos.length === 1) {
    const c = cancelamentos[0];
    return `A consulta de ${c.crianca}, ${c.label}, foi cancelada.`;
  }
  if (cancelamentos.length > 1) {
    return "Os cancelamentos que você pediu foram realizados.";
  }
  if (ctx.dadosDoPacienteRegistrados) {
    return "Anotei os dados que você enviou. Obrigada 😊";
  }
  if (ctx.escalar) {
    return "Vou confirmar isso com o Dr. Bruno e já te retorno por aqui.";
  }
  return null;
}

// Se uma ferramenta já produziu efeito e a chamada seguinte ao modelo falhar, o efeito não
// pode sumir do retorno. O servidor ainda precisa atualizar a sessão, notificar o Dr. Bruno e
// dizer à família o que realmente aconteceu.
function recuperarAposFalha({ historico, texto, ctx }) {
  const respostaComEfeito = respostaDepoisDosEfeitos(ctx);
  const resposta = respostaComEfeito || "Deu uma instabilidade aqui do meu lado, pode repetir sua mensagem?";
  const novoHistorico = respostaComEfeito
    ? [...historico, { role: "user", content: texto }, { role: "assistant", content: resposta }].slice(-24)
    : historico;

  return {
    resposta,
    historico: novoHistorico,
    acoes: ctx.acoesRealizadas || [],
    cancelamentos: ctx.cancelamentosRealizados || [],
    escalar: ctx.escalar || null,
    escalarPergunta: ctx.escalarPergunta || null,
    escalarData: ctx.escalarData || null,
    escalarHora: ctx.escalarHora || null,
    escalarTipo: ctx.escalarTipo || null,
    dadosDoPaciente: ctx.dadosDoPacienteRegistrados || null,
    horariosOferecidos: [...(ctx.horariosOferecidos || [])].slice(-20),
  };
}

module.exports = { recuperarAposFalha };
