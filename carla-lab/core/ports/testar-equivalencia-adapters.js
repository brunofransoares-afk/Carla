// Prova que os dois adapters de persistência se comportam igual.
//
// É o teste que sustenta a Fase 2 inteira. Se o adapter de memória e o de arquivo
// divergirem, então a porta não desacoplou nada: o Core continuaria dependendo de qual
// implementação está por baixo, que é exatamente o problema que a fase existe pra
// resolver. E sem isso o sandbox seria uma imitação, não um ambiente de teste.
//
// A mesma sequência de operações roda nos dois, e cada resposta é comparada.
//
// SEGURANÇA: o adapter de arquivo escreve na pasta data/ de verdade. No servidor, isso
// são os pacientes reais. Este teste SE RECUSA a rodar se encontrar qualquer sinal de
// dados de produção, e a recusa vem antes de qualquer escrita.
//
//   node carla-lab/core/ports/testar-equivalencia-adapters.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const RAIZ = path.join(__dirname, "..", "..", "..");
const DIR_DADOS = path.join(RAIZ, "data");

require(path.join(RAIZ, "..", "carla-app", "js", "config.js"));
require(path.join(RAIZ, "..", "carla-app", "js", "agenda.js"));

function recusarSeForProducao() {
  const motivos = [];

  const arqAgendamentos = path.join(DIR_DADOS, "agendamentos.json");
  if (fs.existsSync(arqAgendamentos)) {
    try {
      const lista = JSON.parse(fs.readFileSync(arqAgendamentos, "utf8"));
      if (Array.isArray(lista) && lista.length > 0) {
        motivos.push(`${arqAgendamentos} tem ${lista.length} agendamento(s)`);
      }
    } catch (_) {
      motivos.push(`${arqAgendamentos} existe e não pôde ser lido`);
    }
  }

  // A pasta de sessão do WhatsApp só existe onde a Carla de verdade já conectou.
  if (fs.existsSync(path.join(DIR_DADOS, "auth"))) {
    motivos.push(`${path.join(DIR_DADOS, "auth")} existe: este é um ambiente com WhatsApp conectado`);
  }
  if (fs.existsSync(path.join(DIR_DADOS, "contatos-whatsapp.json"))) {
    motivos.push(`${path.join(DIR_DADOS, "contatos-whatsapp.json")} existe: há contatos de famílias aqui`);
  }

  if (motivos.length) {
    console.log("\nRECUSADO: isto parece um ambiente com dados reais.\n");
    for (const m of motivos) console.log(`  - ${m}`);
    console.log("\nEste teste escreve na pasta data/ e não vai fazer isso onde há paciente.");
    console.log("Rode num clone limpo, nunca na pasta de produção.\n");
    process.exit(2);
  }
}

recusarSeForProducao();

const memoria = require("../../adapters/persistencia-memoria/index.js");
const arquivo = require("../../adapters/persistencia-arquivo/index.js");

const AGORA = new Date(2026, 6, 27, 7, 0);
const SLOT = { id: "2026-08-03T08:00", date: "2026-08-03", time: "08:00", label: "segunda às 8h" };
const SLOT2 = { id: "2026-08-03T09:30", date: "2026-08-03", time: "09:30", label: "segunda às 9h30" };
// Com "+": só telefones nesse formato recebem lembrete, regra real do storage-node.js.
const TEL = "+5519900000001";

// Cada passo devolve algo comparável. Set vira lista ordenada; objeto grande vira só o
// que o Core realmente usa, pra não comparar carimbo de data e outros detalhes internos.
const PASSOS = [
  ["sessão inexistente", (p) => p.obterSessao(TEL)],
  ["contato desconhecido não é paciente", (p) => p.ehPacienteConhecido(TEL)],
  ["contato silenciado", (p) => p.contatoSilenciado(TEL)],
  ["agenda vazia", (p) => p.lerAgendamentos().length],
  ["nenhum id ocupado", (p) => [...p.idsOcupados(AGORA)].sort()],

  ["reservar", (p) => p.reservar({ slot: SLOT, responsavel: "Ana", crianca: "Beatriz", telefone: TEL }).ok],
  ["reservar de novo o mesmo slot", (p) => p.reservar({ slot: SLOT, responsavel: "Carlos", crianca: "Diego", telefone: TEL }).ok],
  ["agenda com uma consulta", (p) => p.lerAgendamentos().map((a) => [a.slotId, a.responsavel, a.crianca])],
  ["id ocupado aparece", (p) => [...p.idsOcupados(AGORA)].sort()],

  ["lembrete pendente", (p) => p.agendamentosProntosParaLembrete("2026-08-03", "diaDaConsulta").length],
  ["marcar lembrete", (p) => p.marcarLembreteEnviado(SLOT.id, "diaDaConsulta") ?? null],
  ["lembrete não volta", (p) => p.agendamentosProntosParaLembrete("2026-08-03", "diaDaConsulta").length],
  ["lembrete de semana mira outra data", (p) => p.agendamentosProntosParaLembrete("2026-08-03", "semanaAntes").length],
  ["lembrete de semana acha o de 7 dias depois", (p) => p.agendamentosProntosParaLembrete("2026-07-27", "semanaAntes").length],

  ["ligar id do prontuário", (p) => p.definirAppAgendamentoId(SLOT.id, "app-123") ?? null],
  ["id do prontuário gravado", (p) => p.lerAgendamentos().map((a) => a.appAgendamentoId)],

  ["registrar contato", (p) => p.registrarContatoWhatsapp(TEL, { nomeSalvo: "Ana Paula" }) ?? null],
  ["agora é paciente conhecido", (p) => p.ehPacienteConhecido(TEL)],
  ["registrar de novo só com pushName", (p) => p.registrarContatoWhatsapp(TEL, { pushName: "aninha" }) ?? null],
  ["continua paciente conhecido", (p) => p.ehPacienteConhecido(TEL)],

  ["salvar sessão", (p) => p.salvarSessao(TEL, { historico: [{ role: "user", content: "oi" }], aguardandoHumano: false }) ?? null],
  ["ler sessão", (p) => p.obterSessao(TEL).historico.length],

  ["reservar segundo slot", (p) => p.reservar({ slot: SLOT2, responsavel: "Ana", crianca: "Beatriz", telefone: TEL }).ok],
  ["dois ids ocupados", (p) => [...p.idsOcupados(AGORA)].sort()],

  ["cancelar", (p) => (p.cancelarAgendamento(SLOT.id) || {}).slotId ?? null],
  ["cancelar de novo", (p) => p.cancelarAgendamento(SLOT.id)],
  ["sobrou uma consulta", (p) => p.lerAgendamentos().map((a) => a.slotId)],
  ["horário liberado volta a aceitar reserva", (p) => p.reservar({ slot: SLOT, responsavel: "Novo", crianca: "Novo", telefone: TEL }).ok],

  ["alerta não levanta erro", (p) => p.registrarAlertaUrgencia({ telefone: TEL, mensagem: "socorro" }) ?? null],
  ["grade fixa tem os mesmos slots", (p) => p.slotsPossiveisComExtras(AGORA).length],
  ["nenhum extra disponível", (p) => p.extrasDisponiveis(AGORA, p.idsOcupados(AGORA)).length],
];

function limparDados() {
  if (!fs.existsSync(DIR_DADOS)) return;
  for (const arq of fs.readdirSync(DIR_DADOS)) {
    fs.rmSync(path.join(DIR_DADOS, arq), { recursive: true, force: true });
  }
}

limparDados();

const emMemoria = memoria.criar();
const divergencias = [];
let iguais = 0;

for (const [nome, passo] of PASSOS) {
  let a;
  let b;
  let erroA = null;
  let erroB = null;
  try { a = passo(emMemoria); } catch (e) { erroA = e.message; }
  try { b = passo(arquivo); } catch (e) { erroB = e.message; }

  if (erroA || erroB) {
    divergencias.push(`${nome}\n      memória: ${erroA || "ok"}\n      arquivo: ${erroB || "ok"}`);
    continue;
  }

  const ja = JSON.stringify(a === undefined ? null : a);
  const jb = JSON.stringify(b === undefined ? null : b);
  if (ja === jb) {
    iguais += 1;
    console.log(`  igual  ${nome}`);
  } else {
    divergencias.push(`${nome}\n      memória: ${ja}\n      arquivo: ${jb}`);
    console.log(`  DIFERE ${nome}`);
  }
}

limparDados();

console.log("");
if (divergencias.length) {
  console.log("Divergências entre os adapters:\n");
  for (const d of divergencias) console.log(`  ${d}\n`);
  console.log(`${iguais} de ${PASSOS.length} passos idênticos. A porta ainda não desacoplou.`);
  process.exit(1);
}
console.log(`${iguais} de ${PASSOS.length} passos idênticos nos dois adapters.`);
console.log("A porta de persistência é substituível: o Core não depende de quem está por baixo.");
