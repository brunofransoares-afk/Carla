/*
 * Bateria de quem ouve a apresentação, e quantas vezes.
 *
 * A Carla passou a dizer que é o atendimento automático. Só que quem já falou com ela antes
 * nunca ia ouvir isso: pra família conhecida o prompt manda cumprimentar direto, sem
 * reapresentar o consultório. A base inteira ficaria de fora justo da frase que a mudança
 * existe pra dizer.
 *
 * A REGRA, que é do Dr. Bruno: todo mundo ouve, menos quem o painel mostra como Paciente.
 * Esses ele conhece pessoalmente, e anunciar automação pra eles seria estranho.
 *
 * E UMA VEZ SÓ, POR NÚMERO, PRA SEMPRE. Isso não foi pedido, foi acrescentado, e o motivo
 * está num defeito que já aconteceu aqui: sem o "uma vez", a família que marcou consulta com
 * ela mas não está salva na agenda do celular receberia a apresentação de novo a cada
 * conversa nova, inclusive na véspera da consulta. O comentário do ehPacienteConhecido conta
 * o caso: ela chegou a se reapresentar 27 minutos depois de mandar o lembrete do dia.
 *
 * A marca fica no CADASTRO DO CONTATO, não na sessão. Sessão o painel limpa e expira em 4
 * horas; isto precisa valer pra sempre, senão o "uma vez" vira "uma vez por tarde".
 *
 * Roda com:  node tests/apresentacao-uma-vez.test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

// storage-node.js grava em disco de verdade, então roda numa cópia descartável.
const RAIZ = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "carla-apres-")), "bot");
fs.mkdirSync(path.join(RAIZ, "data"), { recursive: true });
fs.copyFileSync(path.join(__dirname, "..", "storage-node.js"), path.join(RAIZ, "storage-node.js"));
fs.copyFileSync(path.join(__dirname, "..", "arquivo-atomico.js"), path.join(RAIZ, "arquivo-atomico.js"));
// storage-node puxa config.js e agenda.js da pasta irmã. Nada do que esta bateria testa
// (paciente, apresentação, contatos) passa por eles, então dublês bastam — e assim a bateria
// roda em máquina onde carla-app não existe, que é o caso hoje: a pasta não está em git
// nenhum e já sumiu de um ambiente. As três funções abaixo são as únicas que storage-node
// chama de Agenda; se um dia chamar mais, o require quebra aqui e alguém fica sabendo.
const IRMA = path.join(RAIZ, "..", "carla-app", "js");
fs.mkdirSync(IRMA, { recursive: true });
fs.writeFileSync(path.join(IRMA, "config.js"), "global.CARLA_CONFIG = global.CARLA_CONFIG || {};\n");
fs.writeFileSync(path.join(IRMA, "agenda.js"), [
  "const p2 = (n) => String(n).padStart(2, \"0\");",
  "module.exports = {",
  "  gerarSlotsPossiveis: () => [],",
  "  formatHora: (h) => h,",
  "  toDateStr: (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,",
  "};",
].join("\n") + "\n");

const Storage = require(path.join(RAIZ, "storage-node.js"));

const NOVO = "+5519900000001";      // ninguém conhece
const SALVO = "+5519900000002";     // salvo na agenda do celular
const MARCADO = "+5519900000003";   // marcado no botão do painel
const SO_CONSULTA = "+5519900000004"; // marcou consulta, mas não é salvo nem marcado
// Só nome salvo, e a seção de marcação manual NÃO encosta nele. Sem um contato assim, um
// bug que trocasse a fórmula do painel por "só o botão manual" passaria despercebido:
// era o que acontecia antes, porque o SALVO acabava marcado à mão no teste 1f.
const SO_SALVO = "+5519900000006";

Storage.registrarContatoWhatsapp(NOVO, { pushName: "Alguém" });
Storage.registrarContatoWhatsapp(SALVO, { nomeSalvo: "Mãe do Pedro" });
Storage.registrarContatoWhatsapp(MARCADO, { pushName: "Sávio" });
Storage.marcarPacienteManual(MARCADO);
Storage.registrarContatoWhatsapp(SO_CONSULTA, { pushName: "Almir" });
Storage.registrarContatoWhatsapp(SO_SALVO, { nomeSalvo: "Pai da Sofia" });
Storage.reservar({
  slot: { id: "s1", date: "2026-09-10", time: "09:00", label: "10/09 às 09:00" },
  responsavel: "Almir", crianca: "Arthur Fantini", telefone: SO_CONSULTA,
});

// ------------------------------------------------- 1. quem o painel mostra como Paciente
{
  eq(Storage.ehPacienteNoPainel(SALVO), true, "1. quem está salvo na agenda do celular é Paciente no painel");
  eq(Storage.ehPacienteNoPainel(MARCADO), true, "1b. quem foi marcado no botão também");
  eq(Storage.ehPacienteNoPainel(NOVO), false, "1c. contato novo não é");
  eq(Storage.ehPacienteNoPainel(SO_SALVO), true,
    "1g. estar salvo na agenda basta, sem precisar do botão: são dois caminhos, não um");
  eq(Storage.ehPacienteNoPainel(SO_CONSULTA), false,
    "1d. quem SÓ marcou consulta não aparece como Paciente no painel, então ouve a apresentação");

  // O "não-paciente" forçado sobrepõe tudo, inclusive o nome salvo. É como o Dr. Bruno testa
  // a experiência de quem chega novo, usando o próprio número.
  Storage.desmarcarPacienteManual(SALVO);
  eq(Storage.ehPacienteNoPainel(SALVO), false, "1e. forçar não-paciente sobrepõe o nome salvo");
  Storage.marcarPacienteManual(SALVO);
  eq(Storage.ehPacienteNoPainel(SALVO), true, "1f. e marcar de volta funciona");
}

// ------------------------------------------------- 2. a etiqueta do painel e a Carla não separam
{
  // As duas leem a MESMA função. Se alguém mudar uma sem a outra, a tela passa a dizer uma
  // coisa e a Carla a fazer outra, e ninguém descobre porque nada quebra.
  const contatos = Storage.listarTodosContatos();
  for (const tel of [NOVO, SALVO, MARCADO, SO_CONSULTA, SO_SALVO]) {
    const c = contatos.find((x) => x.telefone === tel);
    ok(c, "2. o contato " + tel + " aparece na lista do painel");
    eq(c.ehPaciente, Storage.ehPacienteNoPainel(tel),
      "2b. a etiqueta do painel bate com o que a Carla consulta, em " + tel);
  }
}

// ------------------------------------------------- 3. uma vez, e nunca mais
{
  eq(Storage.jaSeApresentou(NOVO), false, "3. antes de tudo, ninguém ouviu ainda");
  eq(Storage.marcarApresentacao(NOVO), true, "3b. a primeira marcação vale");
  eq(Storage.jaSeApresentou(NOVO), true, "3c. e fica registrada");
  eq(Storage.marcarApresentacao(NOVO), false, "3d. a segunda não faz nada, e devolve false pra não logar duas vezes");
}

// ------------------------------------------------- 4. a marca sobrevive ao que apaga sessão
{
  // O painel tem botão de limpar conversa, e o histórico expira sozinho em 4 horas. Nenhum
  // dos dois pode fazer a família ouvir a apresentação de novo.
  eq(Storage.jaSeApresentou(SO_CONSULTA), false, "4. o Almir ainda não ouviu");
  Storage.marcarApresentacao(SO_CONSULTA);
  Storage.salvarSessao(SO_CONSULTA, { telefone: SO_CONSULTA, historico: [{ role: "user", content: "oi" }], ultimaAtividade: new Date().toISOString() });
  Storage.salvarSessao(SO_CONSULTA, { telefone: SO_CONSULTA, historico: [], ultimaAtividade: null });
  eq(Storage.jaSeApresentou(SO_CONSULTA), true, "4b. zerar a sessão não apaga que ele já ouviu");

  // E não atropela o que já estava guardado do contato.
  const contato = Storage.listarTodosContatos().find((c) => c.telefone === SO_CONSULTA);
  eq(contato.nome, "Almir", "4c. marcar a apresentação não apaga o nome do contato");
}

// ------------------------------------------------- 5. a decisão, do jeito que o server monta
{
  // Reproduz a condição exata de server.js, pra a bateria falhar se a regra mudar lá.
  const precisa = (tel, primeiraMensagem) =>
    primeiraMensagem && !Storage.ehPacienteNoPainel(tel) && !Storage.jaSeApresentou(tel);

  const FRESCO = "+5519900000005";
  Storage.registrarContatoWhatsapp(FRESCO, { pushName: "Nova" });

  eq(precisa(FRESCO, true), true, "5. contato novo, primeira mensagem: apresenta");
  eq(precisa(FRESCO, false), false, "5b. no meio da conversa: não apresenta");
  eq(precisa(MARCADO, true), false, "5c. Paciente marcado no painel: NUNCA apresenta");
  eq(precisa(SALVO, true), false, "5d. salvo na agenda do celular: NUNCA apresenta");
  eq(precisa(SO_SALVO, true), false, "5g. só salvo na agenda, sem botão nenhum: também NUNCA apresenta");
  eq(precisa(SO_CONSULTA, true), false, "5e. o Almir já ouviu, então não ouve de novo");

  Storage.marcarApresentacao(FRESCO);
  eq(precisa(FRESCO, true), false, "5f. depois de ouvir, nunca mais");
}

// ------------------------------------------------- 6. o server e o prompt estão ligados certo
{
  const SERVER = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const CEREBRO = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");

  ok(/precisaSeApresentar: ehPrimeiraMensagemDaConversa/.test(SERVER), "6. o server calcula a decisão");
  ok(/!Storage\.ehPacienteNoPainel\(telefone\)/.test(SERVER), "6b. e exclui quem o painel mostra como Paciente");
  ok(/!Storage\.jaSeApresentou\(telefone\)/.test(SERVER), "6c. e exclui quem já ouviu");
  ok(/const ehPrimeiraMensagemDaConversa = \(sessao\.historico \|\| \[\]\)\.length === 0;/.test(SERVER),
    "6d. 'primeira mensagem' é medida ANTES de a IA escrever no histórico");

  // Agora a marcação é um efeito durável da caixa de saída. Se a rede cair, a mensagem fica
  // pendente; se cair depois do envio, o efeito é retomado sem mandar a mensagem duas vezes.
  const CAIXA = fs.readFileSync(path.join(__dirname, "..", "caixa-de-saida.js"), "utf8");
  const posEntregue = CAIXA.indexOf("marcarMensagemPendenteEnviada");
  const posEfeito = CAIXA.indexOf("aplicarEfeito(atual.efeitoAposEnvio)");
  ok(posEntregue > 0 && posEfeito > posEntregue
    && /efeitoAposEnvio: \{ tipo: "marcar_apresentacao", telefone \}/.test(SERVER),
  "6e. marca a apresentação como efeito posterior à entrega");

  ok(/precisaSeApresentar = false/.test(CEREBRO), "6f. o cérebro recebe a decisão, e o padrão é não apresentar");
  ok(/o atendimento automático do consultório do Dr\. Bruno 😊/.test(CEREBRO), "6g. e sabe o que dizer");
  ok(/Não reapresente o consultório, não liste o que você resolve/.test(CEREBRO),
    "6h. pra quem já é conhecido é UMA frase, não a abertura inteira: quem tem consulta amanhã não pode ser tratado como contato novo");
}

console.log(`\napresentacao-uma-vez: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
