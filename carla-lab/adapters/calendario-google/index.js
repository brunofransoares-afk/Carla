// Adapter de calendário sobre o google-agenda.js que já está em produção.
//
// Fino de propósito, igual ao de persistência: enquanto a Carla Original rodar, este
// adapter e o caminho antigo precisam ser a mesma coisa.
//
// O módulo real exige a biblioteca googleapis, que nem todo ambiente tem. Por isso ele é
// carregado sob demanda: dá pra inspecionar e conferir a conformidade desta porta sem
// instalar nada.

const path = require("path");

let Google = null;
function google() {
  if (!Google) Google = require(path.join(__dirname, "..", "..", "..", "google-agenda.js"));
  return Google;
}

module.exports = {
  nome: "calendario-google",
  // null = não deu pra checar. O Core segue com a checagem local; fail-open é deliberado.
  estaLivre: (inicio, fim) => google().estaLivre(inicio, fim),
  criarEvento: (dados) => google().criarEvento(dados),
  cancelarEvento: (eventId) => google().cancelarEvento(eventId),
};
