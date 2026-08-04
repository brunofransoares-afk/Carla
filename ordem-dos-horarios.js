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
//
// MANHÃ E TARDE (o segundo defeito, este causado por mim). A agenda já espalhava as duas
// opções entre manhã e tarde, em escolherComDiversidade, lá no agenda.js. Só que eu pegava
// o resultado dela e reordenava tudo por tempo aqui — o espalhamento ia embora e os dois
// primeiros passavam a ser simplesmente os dois mais cedo. Virou "terça às 8h ou terça às
// 9h30": mesma manhã, quase colados, o que na prática é uma opção só.
//
// Então o espalhamento volta, mas aqui, depois de grade e extras já estarem juntos. A
// segunda opção é o horário mais cedo de PERÍODO diferente do primeiro.
//
// Não forço dia diferente de propósito, mesmo tendo sido assim antes. Se forçasse, um
// extra que o Dr. Bruno abriu pra amanhã à tarde perderia pra um da grade de segunda que
// vem, só por ser outro dia — que é exatamente o defeito lá de cima, voltando por outra
// porta. Dia diferente continua acontecendo sozinho na maioria das vezes, porque é raro o
// mesmo dia ter manhã e tarde livres.

function porTempo(a, b) {
  return (a.date + a.time).localeCompare(b.date + b.time);
}

// 12:00 é o mesmo corte que o resto do sistema usa pra separar manhã de tarde.
function periodoDo(slot) {
  return slot.time < "12:00" ? "manha" : "tarde";
}

// Reordena sem perder nem duplicar nada: enquanto existir período ainda não usado, o
// próximo da vez é o horário mais cedo desse período. Depois que manhã e tarde já
// apareceram, o resto segue na ordem de tempo em que chegou.
//
// Quando a família pediu um período específico, todos os candidatos são do mesmo período e
// isso aqui não muda nada — o que está certo: ela pediu tarde, não quer manhã de volta.
function espalhar(lista) {
  const restante = [...lista];
  const ordenada = [];
  while (restante.length > 0) {
    const jaUsados = new Set(ordenada.map(periodoDo));
    let i = restante.findIndex((s) => !jaUsados.has(periodoDo(s)));
    if (i < 0) i = 0;
    ordenada.push(restante.splice(i, 1)[0]);
  }
  return ordenada;
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
    // Sem pedido: grade e extras se misturam por tempo, pra um horário aberto pra amanhã
    // não ficar atrás de um da grade de semana que vem. Depois o espalhamento escolhe a
    // segunda opção num período diferente da primeira.
    return espalhar([...grade, ...extras].sort(porTempo));
  }

  const gradeQueBate = grade.filter((s) => bate(s, filtros));
  const gradeQueNaoBate = grade.filter((s) => !bate(s, filtros));
  // O espalhamento vale só pra quem bate. O resto é alternativa, e alternativa continua na
  // ordem que a grade já tinha escolhido.
  return [
    ...espalhar([...gradeQueBate, ...extras].sort(porTempo)),
    ...gradeQueNaoBate,
  ];
}

module.exports = { ordenarCandidatos, bate, espalhar };
