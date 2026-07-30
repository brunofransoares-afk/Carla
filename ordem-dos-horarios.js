// Em que ordem os horários são oferecidos à família.
//
// A agenda tem duas origens: a grade padrão do consultório e os horários que o Dr. Bruno
// abre na mão pelo painel ("extras"). Pro sistema os dois são horário de verdade, e o
// extra existe justamente porque ele quer aquela vaga preenchida.
//
// O QUE ESTAVA ERRADO. A lista de candidatos era montada assim:
//
//   [ ...seis da grade, ...os extras ]   e o chamador ficava com os 2 primeiros
//
// E a função da grade não filtra de verdade por dia/período/data: ela põe na frente os
// que batem e COMPLETA com o resto até o total pedido. Então, com a grade tendo qualquer
// vaga em qualquer dia, os seis primeiros sempre eram da grade e os extras nunca eram
// alcançados. Um pedido de "amanhã à tarde", com três extras abertos justamente amanhã à
// tarde, respondia "amanhã à tarde não tenho nada livre" e oferecia a segunda-feira
// seguinte. O botão do painel virou enfeite.
//
// A REGRA AGORA. Quem bate com o que a família pediu vem primeiro, venha da grade ou do
// painel, em ordem de tempo. Só depois entra o resto, como alternativa — também em ordem
// de tempo. Sem pedido específico, os dois se misturam por tempo: um horário aberto pra
// amanhã aparece antes de um da grade semana que vem.

function porTempo(a, b) {
  return (a.date + a.time).localeCompare(b.date + b.time);
}

// Os extras já chegam filtrados por quem os buscou, então só a grade precisa ser
// reavaliada aqui — é ela que devolve horário que não bate, pra nunca deixar a família
// sem alternativa nenhuma.
function bate(slot, { diaPreferido = null, periodo = null, dataPreferida = null } = {}) {
  if (dataPreferida !== null && slot.date !== dataPreferida) return false;
  if (diaPreferido !== null && slot.weekday !== diaPreferido) return false;
  if (periodo === "manha" && slot.time >= "12:00") return false;
  if (periodo === "tarde" && slot.time < "12:00") return false;
  return true;
}

// grade: o que Agenda.oferecerSlots devolveu (pode conter horário que não bate)
// extras: o que Storage.extrasDisponiveis devolveu (já vem só o que bate)
// filtros: { diaPreferido, periodo, dataPreferida }
function ordenarCandidatos(grade = [], extras = [], filtros = {}) {
  const { diaPreferido = null, periodo = null, dataPreferida = null } = filtros;
  const pediuAlgo = diaPreferido !== null || periodo !== null || dataPreferida !== null;

  if (!pediuAlgo) {
    // Sem pedido: a grade já vem na ordem que o consultório prefere (concentrar visitas no
    // mesmo dia). Os extras entram por tempo entre eles, pra um horário aberto pra amanhã
    // não ficar atrás de um da grade de semana que vem.
    return [...grade, ...extras].sort(porTempo);
  }

  const gradeQueBate = grade.filter((s) => bate(s, filtros));
  const gradeQueNaoBate = grade.filter((s) => !bate(s, filtros));
  return [
    ...[...gradeQueBate, ...extras].sort(porTempo),
    ...gradeQueNaoBate,
  ];
}

module.exports = { ordenarCandidatos, bate };
