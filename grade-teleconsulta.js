"use strict";

// Grade FIXA de teleconsulta: horários que existem toda semana, só pra atendimento por vídeo.
//
// Os extras do painel são por DATA ("dia 14 às 13h"). Isto aqui é por DIA DA SEMANA, pra
// sempre: terça 20h, quarta 20h, sexta 18h/19h/20h. Em vez de o Dr. Bruno liberar cinco
// horários toda semana na mão, a regra gera os extras sozinha, dentro do horizonte, e eles
// entram na roda EXATAMENTE como um extra marcado "só teleconsulta": mesmo id, mesma
// reserva, mesmo bloqueio individual pelo painel.
//
// Quarta-feira não tem atendimento presencial nenhum; à noite tem teleconsulta. É por isso
// que "quarta" passou a existir no filtro de dia da Carla: só faz sentido pra vídeo.
//
// POR QUE UM MÓDULO PURO. A regra é política do consultório, como o preço. Ela mora aqui,
// sem depender do storage nem da agenda, pra bateria conseguir provar quais datas saem
// sem subir nada.

const GRADE_FIXA = [
  { diaSemana: 2, hora: "20:00" }, // terça
  { diaSemana: 3, hora: "20:00" }, // quarta
  { diaSemana: 5, hora: "18:00" }, // sexta
  { diaSemana: 5, hora: "19:00" },
  { diaSemana: 5, hora: "20:00" },
];

// Quantas semanas pra frente a grade fixa é materializada. Oito cobre o horizonte que a
// família enxerga numa conversa e não enche o painel de meses de horário vazio.
const SEMANAS_DE_HORIZONTE = 8;

// "Comercial" é durante o dia; "noite" é a partir das 18h. É a pergunta que a Carla faz
// antes de buscar horário de teleconsulta, e é o corte que separa a grade normal dos
// horários fixos de vídeo.
const NOITE_A_PARTIR_DE = "18:00";

function periodoDaHora(hora) {
  return String(hora) >= NOITE_A_PARTIR_DE ? "noite" : "comercial";
}

function dataStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Materializa a grade a partir de `now`: só o futuro, ordenado, no formato dos extras.
function gerarExtrasFixos(now = new Date(), grade = GRADE_FIXA, semanas = SEMANAS_DE_HORIZONTE) {
  const saida = [];
  const inicio = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < semanas * 7; i++) {
    const dia = new Date(inicio);
    dia.setDate(inicio.getDate() + i);
    for (const g of grade) {
      if (dia.getDay() !== g.diaSemana) continue;
      const [h, m] = g.hora.split(":").map(Number);
      if (new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), h, m) <= now) continue;
      saida.push({ data: dataStr(dia), hora: g.hora, soTeleconsulta: true, fixo: true });
    }
  }
  return saida.sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
}

module.exports = { GRADE_FIXA, SEMANAS_DE_HORIZONTE, NOITE_A_PARTIR_DE, periodoDaHora, gerarExtrasFixos };
