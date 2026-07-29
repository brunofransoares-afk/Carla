// Adapter de prontuário sobre o app-agenda.js que já está em produção.
//
// Esta porta é opcional por natureza: nem toda clínica terá prontuário integrado. O
// módulo real já trata ausência de configuração ficando inerte, que é exatamente o
// comportamento que o contrato pede.

const path = require("path");

let App = null;
function app() {
  if (!App) App = require(path.join(__dirname, "..", "..", "..", "app-agenda.js"));
  return App;
}

module.exports = {
  nome: "prontuario-supabase",
  enviarAgendamento: (dados) => app().enviarAgendamento(dados),
  cancelarAgendamento: (appAgendamentoId) => app().cancelarAgendamento(appAgendamentoId),
};
