// Adapter de persistência sobre o storage-node.js que já está em produção.
//
// Não reimplementa nada: só dá ao código existente o formato das portas. É de propósito
// que ele seja fino assim. Enquanto a Carla Original estiver rodando, este adapter e o
// caminho antigo precisam ser a mesma coisa, e a única forma de garantir isso é não
// escrever lógica nova aqui.
//
// CUIDADO: este adapter escreve na pasta data/ real, que no servidor são os pacientes de
// verdade. Testes de comportamento rodam contra o adapter de memória, nunca contra este.

const path = require("path");

// Carregado sob demanda: storage-node.js exige a pasta carla-app ao lado do repositório,
// e quem só quer inspecionar as portas não deveria precisar disso.
let Storage = null;
function storage() {
  if (!Storage) Storage = require(path.join(__dirname, "..", "..", "..", "storage-node.js"));
  return Storage;
}

module.exports = {
  nome: "persistencia-arquivo",

  // --- Agenda ---
  lerAgendamentos: () => storage().lerAgendamentos(),
  idsOcupados: (agora) => storage().idsOcupados(agora),
  // storage-node.js devolve booleano. A porta pede { ok }, porque o Core precisa poder
  // distinguir "não deu" de "não deu por causa disto" quando houver mais de um motivo.
  // Traduzir formato é exatamente para isso que um adapter existe.
  reservar: (dados) => ({ ok: storage().reservar(dados) === true }),
  cancelarAgendamento: (slotId) => storage().cancelarAgendamento(slotId),
  definirAppAgendamentoId: (slotId, appId) => storage().definirAppAgendamentoId(slotId, appId),
  agendamentosProntosParaLembrete: (hojeStr, tipo) => storage().agendamentosProntosParaLembrete(hojeStr, tipo),
  marcarLembreteEnviado: (slotId, tipo) => storage().marcarLembreteEnviado(slotId, tipo),

  // --- Grade ---
  slotsPossiveisComExtras: (agora) => storage().slotsPossiveisComExtras(agora),
  extrasDisponiveis: (agora, ocupados, filtros) => storage().extrasDisponiveis(agora, ocupados, filtros),

  // --- Conversa ---
  obterSessao: (telefone) => storage().obterSessao(telefone),
  salvarSessao: (telefone, sessao) => storage().salvarSessao(telefone, sessao),

  // --- Contatos ---
  registrarContatoWhatsapp: (telefone, dados) => storage().registrarContatoWhatsapp(telefone, dados),
  ehPacienteConhecido: (telefone) => storage().ehPacienteConhecido(telefone),
  contatoSilenciado: (telefone) => storage().contatoSilenciado(telefone),

  // --- Alertas ---
  registrarAlertaUrgencia: (dados) => storage().registrarAlertaUrgencia(dados),
};
