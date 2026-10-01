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
  // O corte da teleconsulta: "comercial" é antes das 18h, "noite" é das 18h em diante. A
  // grade normal inteira é comercial; os horários fixos de vídeo são noite.
  if (periodo === "noite" && slot.time < "18:00") return false;
  if (periodo === "comercial" && slot.time >= "18:00") return false;
  return true;
}

/*
 * A AGENDA CONTÍNUA (2026-10-01). O dono: "a partir do momento que a carla agendou por
 * exemplo um determinado dia e determinado horario pra uma familia, ex. ela marcou um
 * paciente numa quinta feira as 8h, pros outros pacientes que mandarem conversa, ela deve
 * tentar oferecer o horario das 10h com prioridade... nao eh pra forcar a familia, eh so pra
 * colocar no escopo essa inteligencia de ver onde ja tem horario marcado... tentando agendar
 * as consultas de puericultura e atendimento de transtornos, sempre pra uns 2-3 dias de
 * intervalo do dia atual.. ou na proxima semana".
 *
 * DUAS REGRAS DE ORDEM, nenhuma de exclusão (ele foi claro: "não é pra forçar"):
 *
 *   1. FOLGA. A rotina começa a partir de alguns dias depois de hoje. Com a agenda vazia
 *      isso empurra as consultas pra perto de uma semana; quando ela enche, o primeiro livre
 *      anda sozinho pra duas semanas, que é a progressão que ele descreveu, sem fórmula de
 *      ocupação nenhuma. O que fica antes da folga não some: vai pro fim da fila, pra quando
 *      não houver mais nada.
 *   2. VIZINHANÇA. Dentro da folga, primeiro o horário que encosta numa consulta já marcada
 *      no mesmo dia (o anterior ou o seguinte na grade daquele dia). É o que junta as
 *      consultas e deixa o dia dele contínuo, em vez de 8h, buraco, 16h30.
 *
 * A URGÊNCIA NÃO PASSA POR AQUI: ela tem caminho próprio (urgente=true, em cerebro-ia.js),
 * cronológico a partir de amanhã, porque pra quem está com febre a vizinhança não importa.
 *
 * horariosDoDia vem de fora (é o Agenda.horariosDoDia) pra este arquivo continuar sem
 * depender da agenda e rodar em teste sozinho.
 */
function ordenarPraAgendaContinua(lista = [], { ocupados = new Set(), agora = new Date(), diasDeFolga = 0, horariosDoDia = null } = {}) {
  const p2 = (n) => String(n).padStart(2, "0");
  const limite = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + diasDeFolga);
  const limiteStr = `${limite.getFullYear()}-${p2(limite.getMonth() + 1)}-${p2(limite.getDate())}`;

  const encostaEmConsulta = (slot) => {
    if (typeof horariosDoDia !== "function" || !slot.date || !slot.time) return false;
    const [ano, mes, dia] = slot.date.split("-").map(Number);
    const doDia = horariosDoDia(new Date(ano, mes - 1, dia)) || [];
    const i = doDia.indexOf(slot.time);
    if (i < 0) return false;
    const vizinhos = [doDia[i - 1], doDia[i + 1]].filter(Boolean);
    return vizinhos.some((hhmm) => ocupados.has(`${slot.date}T${hhmm}`));
  };

  const ordenados = [...lista].sort(porTempo);
  const depoisDaFolga = ordenados.filter((s) => s.date >= limiteStr);
  const antesDaFolga = ordenados.filter((s) => s.date < limiteStr);
  const encostados = depoisDaFolga.filter(encostaEmConsulta);
  const soltos = depoisDaFolga.filter((s) => !encostados.includes(s));
  return [...encostados, ...soltos, ...antesDaFolga];
}

/*
 * A SEGUNDA OPÇÃO EM OUTRO DIA, quando a primeira é a da agenda contínua.
 *
 * A vizinhança junta as consultas no mesmo dia, e é por isso mesmo que a segunda opção não
 * pode ser do mesmo dia: se quinta não serve pra família, duas opções na quinta são uma
 * opção só. "Não é pra forçar a família" quer dizer isto na prática: a primeira opção é a
 * que ajuda a agenda, a segunda é a que dá escolha de verdade.
 *
 * O espalhamento por período (espalhar, acima) continua valendo no caminho sem continuidade.
 * Aqui ele trocaria um dia diferente por um período diferente no mesmo dia, que é o
 * contrário do que a família precisa quando a primeira opção não serve.
 */
function comAlternativaEmOutroDia(lista = []) {
  if (lista.length < 2) return [...lista];
  const [primeira, ...resto] = lista;
  const i = resto.findIndex((s) => s.date !== primeira.date);
  if (i <= 0) return [...lista];
  const outroDia = resto.splice(i, 1)[0];
  return [primeira, outroDia, ...resto];
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
    //
    // Com a continuidade ligada (é o caso da rotina, sem pedido de dia), a ordem por tempo dá
    // lugar à folga e à vizinhança. O espalhamento continua depois dela, e é ele que garante
    // a escolha pra família: a primeira opção é a que junta a agenda, a segunda é de outro
    // período. Ninguém recebe duas opções iguais pra aceitar ou recusar em bloco.
    const juntos = [...grade, ...extras];
    if (filtros.continuidade) return comAlternativaEmOutroDia(ordenarPraAgendaContinua(juntos, filtros.continuidade));
    return espalhar(juntos.sort(porTempo));
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

// QUEM BATE COM O PEDIDO, por id.
//
// ordenarCandidatos devolve uma lista só, com o que bate na frente e o resto atrás como
// alternativa. Isso está certo pra ORDEM, mas quem consome a lista precisava saber ONDE
// termina uma coisa e começa a outra — sem isso um pedido de "amanhã" voltava "amanhã 9h30"
// e "hoje 14h" no mesmo array, e a Carla oferecia os dois como se os dois fossem amanhã.
//
// O bate() sozinho não serve pra essa conta: extra não tem weekday, então bate() reprovaria
// um extra legítimo num pedido por dia da semana. Os extras já chegam filtrados de quem os
// buscou, então eles batem por construção. É a mesma divisão que ordenarCandidatos faz por
// dentro, exposta aqui pra quem precisa rotular o resultado.
function idsQueBatem(grade = [], extras = [], filtros = {}) {
  return new Set([
    ...extras.map((s) => s.id),
    ...grade.filter((s) => bate(s, filtros)).map((s) => s.id),
  ]);
}

// Separa o que vai ser OFERECIDO do que vai ser oferecido COMO ALTERNATIVA.
//
// Mora aqui, e não solto dentro do cérebro, porque dentro do cérebro isso só dava pra
// verificar por grep — e grep não pega a separação sendo desligada por dentro. Aqui roda
// de verdade em teste, sem precisar do agenda.js.
//
// Sem pedido específico não existe alternativa: tudo que voltou é resposta.
function separar(livres = [], idsQueBatemSet = new Set(), pediuAlgo = false) {
  if (!pediuAlgo) return { batem: [...livres], naoBatem: [] };
  return {
    batem: livres.filter((s) => idsQueBatemSet.has(s.id)),
    naoBatem: livres.filter((s) => !idsQueBatemSet.has(s.id)),
  };
}

module.exports = { ordenarCandidatos, ordenarPraAgendaContinua, comAlternativaEmOutroDia, bate, espalhar, idsQueBatem, separar };
