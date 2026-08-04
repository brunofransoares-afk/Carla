// Até quando a família tem pra pagar, pra a consulta ser confirmada.
//
// O Dr. Bruno tomou um calote e mudou a regra: ninguém mais é atendido sem ter pago antes.
// Reservar o horário não confirma mais nada — o que confirma é o pagamento.
//
// A REGRA DELE, literal:
//   consulta à TARDE  ->  dá pra pagar até a manhã do mesmo dia
//   consulta de MANHÃ ->  tem que estar pago no dia anterior
//
// POR QUE ISSO É CÓDIGO E NÃO PROMPT. A Carla teria que olhar o horário da consulta, o dia
// de hoje, o dia da semana e a hora, e converter tudo numa frase certa. É exatamente o tipo
// de conta que ela erra de vez em quando, e errar aqui é dizer pra família um prazo que não
// existe. Então a conta é feita aqui e ela recebe a frase pronta.
//
// O CASO EM CIMA DA HORA. Marcar hoje pra amanhã cedo, ou hoje pra hoje à tarde depois do
// meio-dia, deixa o prazo no passado. Aí não tem prazo: ou paga agora, ou não confirma.

const NOMES_DIA = [
  "domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado",
];

function soODia(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function ddmm(d) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// slot: { date: "AAAA-MM-DD", time: "HH:MM" }
// now:  Date
//
// Devolve:
//   agora  true quando o prazo já passou ou está em cima: só confirma pagando na hora
//   texto  a frase pronta pra Carla usar ("até amanhã de manhã", "ainda hoje",
//          "até terça-feira (04/08)")
function prazoDePagamento(slot, now) {
  const [ano, mes, dia] = String(slot.date).split("-").map(Number);
  const daConsulta = new Date(ano, mes - 1, dia);
  const ehDeTarde = String(slot.time) >= "12:00";

  // Consulta de tarde fecha ao meio-dia do próprio dia. Consulta de manhã fecha no fim do
  // dia anterior: o dia inteiro anterior serve, mas o dia da consulta não.
  const limite = new Date(daConsulta);
  if (ehDeTarde) {
    limite.setHours(12, 0, 0, 0);
  } else {
    limite.setDate(limite.getDate() - 1);
    limite.setHours(23, 59, 59, 999);
  }

  if (now >= limite) return { agora: true, texto: "agora" };

  // O dia em que o dinheiro precisa entrar. Não é o limite exato, é o dia que a família
  // enxerga no calendário dela.
  const diaDoPagamento = new Date(daConsulta);
  if (!ehDeTarde) diaDoPagamento.setDate(diaDoPagamento.getDate() - 1);

  const distancia = Math.round((soODia(diaDoPagamento) - soODia(now)) / 86400000);
  let quando;
  if (distancia <= 0) quando = "ainda hoje";
  else if (distancia === 1) quando = "até amanhã";
  else quando = `até ${NOMES_DIA[diaDoPagamento.getDay()]} (${ddmm(diaDoPagamento)})`;

  return { agora: false, texto: ehDeTarde ? `${quando} de manhã` : quando };
}

module.exports = { prazoDePagamento };
