// Testes das portas da Fase 2.
//
// Duas coisas diferentes são verificadas aqui, e a distinção importa:
//
//   CONFORMIDADE  os métodos existem e têm a forma certa. Vale pra todo adapter.
//   COMPORTAMENTO os invariantes da porta valem de verdade. Roda contra o adapter de
//                 memória, nunca contra o de arquivo, porque no servidor a pasta data/
//                 são os pacientes reais.
//
//   node carla-lab/core/ports/testar.js

const path = require("path");
const assert = require("assert");
const { PORTAS, PORTAS_DE_PERSISTENCIA } = require("./index.js");
const { verificarVarias, verificar } = require("./conformidade.js");
const memoria = require("../../adapters/persistencia-memoria/index.js");

// A grade fixa vem da configuração, que é lógica pura. preparar-ambiente.sh monta isso
// fora do servidor a partir dos arquivos versionados na Fase 0.
require(path.join(__dirname, "..", "..", "..", "..", "carla-app", "js", "config.js"));
require(path.join(__dirname, "..", "..", "..", "..", "carla-app", "js", "agenda.js"));

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

// ---------------------------------------------------------------- conformidade

teste("adapter de memória cumpre as 5 portas de persistência", () => {
  const p = memoria.criar();
  const problemas = verificarVarias(p, PORTAS_DE_PERSISTENCIA);
  assert.deepStrictEqual(problemas, [], problemas.join("\n"));
});

teste("adapter de arquivo cumpre as 5 portas de persistência", () => {
  // Só a forma. Nenhum método é chamado, então nada é escrito em disco.
  const p = require("../../adapters/persistencia-arquivo/index.js");
  const problemas = verificarVarias(p, PORTAS_DE_PERSISTENCIA);
  assert.deepStrictEqual(problemas, [], problemas.join("\n"));
});

teste("um adapter incompleto é recusado", () => {
  const problemas = verificar({ lerAgendamentos: () => [] }, "Agenda");
  assert.ok(problemas.length >= 6, `esperava várias faltas, achei ${problemas.length}`);
  assert.ok(problemas.some((p) => p.includes("reservar")), "deveria acusar reservar faltando");
});

teste("um método que não é função é recusado", () => {
  const problemas = verificar({ registrarAlertaUrgencia: "sim" }, "Alertas");
  assert.ok(problemas[0].includes("não é função"), problemas[0]);
});

// ---------------------------------------------------------------- comportamento

const SLOT = { id: "2026-08-03T08:00", date: "2026-08-03", time: "08:00", label: "segunda às 8h" };
// Telefone com "+": só nesse formato o agendamento entra na fila de lembrete. É regra do
// storage-node.js, descoberta pelo teste de equivalência entre os adapters.
const RESERVA = { slot: SLOT, responsavel: "Ana", crianca: "Beatriz", telefone: "+5519999" };

teste("reservar o mesmo horário duas vezes falha na segunda", () => {
  const p = memoria.criar();
  assert.strictEqual(p.reservar(RESERVA).ok, true);
  const segunda = p.reservar({ ...RESERVA, responsavel: "Carlos", crianca: "Diego" });
  assert.strictEqual(segunda.ok, false, "a segunda reserva NÃO pode passar");
  assert.strictEqual(p.lerAgendamentos().length, 1, "não pode ter duas famílias no mesmo horário");
});

teste("idsOcupados devolve Set, não lista", () => {
  const p = memoria.criar();
  p.reservar(RESERVA);
  const ocupados = p.idsOcupados(new Date(2026, 7, 1));
  assert.ok(ocupados instanceof Set, "o Core usa .has(), então precisa ser Set");
  assert.ok(ocupados.has(SLOT.id));
});

teste("cancelar algo que não existe devolve null, sem erro", () => {
  const p = memoria.criar();
  assert.strictEqual(p.cancelarAgendamento("nao-existe"), null);
});

teste("cancelar libera o horário para nova reserva", () => {
  const p = memoria.criar();
  p.reservar(RESERVA);
  assert.ok(p.cancelarAgendamento(SLOT.id));
  assert.strictEqual(p.reservar(RESERVA).ok, true, "depois de cancelar, o horário volta a existir");
});

teste("lembrete marcado não volta para a fila", () => {
  const p = memoria.criar();
  p.reservar(RESERVA);
  assert.strictEqual(p.agendamentosProntosParaLembrete("2026-08-03", "diaDaConsulta").length, 1);
  p.marcarLembreteEnviado(SLOT.id, "diaDaConsulta");
  assert.strictEqual(
    p.agendamentosProntosParaLembrete("2026-08-03", "diaDaConsulta").length,
    0,
    "é isto que impede a família de receber o mesmo lembrete duas vezes",
  );
  // O lembrete da semana é outro e continua pendente, mas mira a data de 7 dias ANTES.
  assert.strictEqual(p.agendamentosProntosParaLembrete("2026-07-27", "semanaAntes").length, 1);
});

teste("agendamento sem telefone de verdade não entra na fila de lembrete", () => {
  const p = memoria.criar();
  // O painel lança consulta com telefone de placeholder. Mandar lembrete pra isso seria
  // mandar mensagem pra lugar nenhum.
  p.reservar({ ...RESERVA, telefone: "(a confirmar)" });
  assert.strictEqual(p.agendamentosProntosParaLembrete("2026-08-03", "diaDaConsulta").length, 0);
});

teste("dia bloqueado no painel some da lista de horários livres", () => {
  const p = memoria.criar();
  const agora = new Date(2026, 6, 27, 7, 0);
  const livresAntes = [...p.idsOcupados(agora)].length;
  p._bloquearDia("2026-07-30");
  const ocupados = p.idsOcupados(agora);
  assert.ok(ocupados.size > livresAntes, "bloquear o dia precisa ocupar os horários dele");
  assert.ok([...ocupados].every((id) => id.startsWith("2026-07-30")), "só o dia bloqueado");
});

teste("lerAgendamentos não deixa o chamador alterar o estado por dentro", () => {
  const p = memoria.criar();
  p.reservar(RESERVA);
  p.lerAgendamentos()[0].crianca = "ALTERADO";
  assert.strictEqual(p.lerAgendamentos()[0].crianca, "Beatriz", "a lista devolvida é cópia");
});

teste("primeira mensagem devolve sessão null, e isso não é erro", () => {
  const p = memoria.criar();
  assert.strictEqual(p.obterSessao("5519000"), null);
  p.salvarSessao("5519000", { historico: [{ role: "user", content: "oi" }] });
  assert.strictEqual(p.obterSessao("5519000").historico.length, 1);
});

teste("contato com nome salvo é paciente conhecido", () => {
  const p = memoria.criar();
  assert.strictEqual(p.ehPacienteConhecido("5519111"), false);
  p.registrarContatoWhatsapp("5519111", { nomeSalvo: "Ana Paula" });
  assert.strictEqual(p.ehPacienteConhecido("5519111"), true);
});

teste("marcação manual de NÃO paciente vence a detecção automática", () => {
  const p = memoria.criar();
  p.registrarContatoWhatsapp("5519111", { nomeSalvo: "Ana Paula" });
  p._marcarNaoPaciente("5519111");
  assert.strictEqual(
    p.ehPacienteConhecido("5519111"),
    false,
    "é o que faz o botão de remover paciente funcionar mesmo em contato detectado sozinho",
  );
});

teste("registrar contato duas vezes não duplica nem apaga o que já tinha", () => {
  const p = memoria.criar();
  p.registrarContatoWhatsapp("5519111", { nomeSalvo: "Ana" });
  p.registrarContatoWhatsapp("5519111", { pushName: "aninha" });
  assert.strictEqual(p.estado.contatos["5519111"].nomeSalvo, "Ana", "pushName não pode apagar nomeSalvo");
  assert.strictEqual(p.estado.contatos["5519111"].pushName, "aninha");
});

teste("horário extra aparece na grade e some quando é reservado", () => {
  const p = memoria.criar();
  const agora = new Date(2026, 6, 27, 7, 0);
  p._adicionarExtra("2026-07-31", "14:00"); // sexta à tarde, que a grade fixa não tem

  const extras = p.extrasDisponiveis(agora, p.idsOcupados(agora));
  assert.strictEqual(extras.length, 1);
  assert.strictEqual(extras[0].id, "extra-2026-07-31-14:00");

  p.reservar({ ...RESERVA, slot: extras[0] });
  assert.strictEqual(
    p.extrasDisponiveis(agora, p.idsOcupados(agora)).length,
    0,
    "extra reservado não pode continuar sendo oferecido",
  );
});

teste("grade com extras inclui a grade fixa", () => {
  const p = memoria.criar();
  const agora = new Date(2026, 6, 27, 7, 0);
  const semExtra = p.slotsPossiveisComExtras(agora).length;
  p._adicionarExtra("2026-07-31", "14:00");
  assert.strictEqual(p.slotsPossiveisComExtras(agora).length, semExtra + 1);
  assert.ok(semExtra > 50, `a grade fixa deveria vir junto, vieram ${semExtra} slots`);
});

teste("registrar alerta nunca levanta erro", () => {
  const p = memoria.criar();
  assert.doesNotThrow(() => p.registrarAlertaUrgencia({ telefone: "5519", mensagem: "socorro" }));
  assert.strictEqual(p.estado.alertas.length, 1);
});

// ---------------------------------------------------------------- execução

let ok = 0;
const falhas = [];
for (const [nome, fn] of testes) {
  try {
    fn();
    ok += 1;
    console.log(`  ok   ${nome}`);
  } catch (erro) {
    falhas.push(`  FALHOU  ${nome}\n          ${erro.message.split("\n")[0]}`);
  }
}

console.log("");
if (falhas.length) {
  console.log(falhas.join("\n"));
  console.log(`\n${ok} de ${testes.length} testes passaram.`);
  process.exit(1);
}
console.log(`${ok} de ${testes.length} testes passaram.`);
console.log(`${Object.keys(PORTAS).length} portas declaradas, ${PORTAS_DE_PERSISTENCIA.length} cobertas por adapter.`);
