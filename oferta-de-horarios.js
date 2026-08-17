// Registro do que a Carla tem permissão de marcar.
//
// A agenda real é a única fonte de horário: quem decide o que existe e o que está livre é
// consultar_horarios, nunca o texto que a IA escreve. Só que a validação do
// confirmar_agendamento checava apenas se o horário EXISTE e está livre — não se ele tinha
// saído de uma consulta de verdade. Num caso real a Carla ofereceu "quinta (13/08) às 8h"
// com um slotId inventado ("quinta-13/08-08:00", num formato que o sistema nem usa) e
// tentou marcar. Ali o formato torto denunciou; um chute bem formado, num horário que por
// acaso existisse e estivesse livre, teria marcado sem ninguém notar.
//
// Então todo horário devolvido pela ferramenta entra aqui, e o confirmar_agendamento só
// aceita slotId que esteja nesta lista. Fica num arquivo próprio, sem dependência nenhuma,
// pra bateria de teste poder exercitar a regra sem carregar o SDK e a agenda inteira.

// Anota os horários que a ferramenta acabou de devolver. Devolve o mesmo resultado, pra
// dar pra usar direto no return de quem chama.
// As alternativas contam igual: elas são horários reais que a ferramenta devolveu, só que de
// outro dia/período do que a família pediu. Se a família aceitar uma delas, a Carla precisa
// poder marcar — sem isso o confirmar_agendamento recusaria um horário que a própria
// ferramenta ofereceu.
function anotarOferta(ctx, resultado) {
  const listas = [(resultado && resultado.horarios) || [], (resultado && resultado.alternativas) || []];
  for (const lista of listas) {
    for (const h of lista) {
      if (h && h.slotId) ctx.horariosOferecidos.add(h.slotId);
    }
  }
  return resultado;
}

module.exports = { anotarOferta };
