/* Roda com: node tests/integracoes-duraveis.test.js — nenhuma chamada sai para a rede. */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { criarCaixaDeEfeitos } = require("../caixa-de-efeitos.js");
const { criarIntegracoesDuraveis, eventIdGoogleDoSlot } = require("../integracoes-duraveis.js");

let passou = 0, falhou = 0;
const erros = [];
function ok(condicao, mensagem) {
  if (condicao) passou++;
  else { falhou++; erros.push(mensagem); }
}
function eq(atual, esperado, mensagem) {
  ok(atual === esperado, `${mensagem} (esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)})`);
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), "carla-efeitos-"));
const logger = { log: () => {}, warn: () => {}, error: () => {} };

(async () => {
  try {
    // ------------------------------------------------ caixa genérica: persistência, dedupe e backoff
    let instante = new Date("2026-08-27T12:00:00.000Z");
    let deveFalhar = true;
    const chavesExecutadas = [];
    const arquivoCaixa = path.join(base, "caixa.json");
    const opcoes = {
      caminho: arquivoCaixa,
      logger,
      agora: () => new Date(instante),
      aleatorio: () => 0.5,
      atrasoBaseMs: 1_000,
      handlers: {
        teste: async (_efeito, chave) => {
          chavesExecutadas.push(chave);
          if (deveFalhar) throw new Error("serviço fora");
          return { ok: true };
        },
      },
    };
    const caixa = criarCaixaDeEfeitos(opcoes);
    const primeiro = await caixa.registrar({ chaveIdempotencia: "teste:1", tipo: "teste", dados: { a: 1 } });
    const repetido = await caixa.registrar({ chaveIdempotencia: "teste:1", tipo: "teste", dados: { a: 1 } });
    eq(repetido.id, primeiro.id, "a chave idempotente não duplica o efeito");

    let resumo = await caixa.reconciliar();
    eq(resumo.falhos.length, 1, "a falha remota fica registrada");
    let salvo = await caixa.obter("teste:1");
    eq(salvo.estado, "falhou", "estado explícito falhou");
    eq(salvo.tentativas, 1, "contabiliza a tentativa");
    ok(fs.existsSync(arquivoCaixa), "efeito existe em arquivo durável");

    const caixaDepoisDoRestart = criarCaixaDeEfeitos(opcoes);
    resumo = await caixaDepoisDoRestart.reconciliar();
    eq(resumo.executados, 0, "backoff impede repetição imediata");
    instante = new Date(instante.getTime() + 1_001);
    deveFalhar = false;
    resumo = await caixaDepoisDoRestart.reconciliar();
    eq(resumo.concluidos.length, 1, "reconciliador retoma após restart e backoff");
    salvo = await caixaDepoisDoRestart.obter("teste:1");
    eq(salvo.estado, "concluido", "estado explícito concluído");
    eq(chavesExecutadas[0], chavesExecutadas[1], "retry usa a mesma chave de execução");

    // Alterar o conteúdo de uma chave concluída cria uma nova revisão, sem criar outro item.
    await caixaDepoisDoRestart.registrar({ chaveIdempotencia: "teste:1", tipo: "teste", dados: { b: 2 } });
    salvo = await caixaDepoisDoRestart.obter("teste:1");
    eq(salvo.estado, "pendente", "dado novo reabre o efeito concluído");
    eq(salvo.revisao, 2, "dado novo incrementa a revisão idempotente");
    eq((await caixaDepoisDoRestart.listar()).length, 1, "revisão não duplica registro");

    // Duas instâncias (como bot e painel) não podem sobrescrever uma à outra.
    const caixaConcorrente = criarCaixaDeEfeitos(opcoes);
    await Promise.all([
      caixaDepoisDoRestart.registrar({ chaveIdempotencia: "teste:2", tipo: "teste", dados: { origem: "bot" } }),
      caixaConcorrente.registrar({ chaveIdempotencia: "teste:3", tipo: "teste", dados: { origem: "painel" } }),
    ]);
    const todas = await caixaDepoisDoRestart.listar();
    ok(todas.some((e) => e.chaveIdempotencia === "teste:2") &&
      todas.some((e) => e.chaveIdempotencia === "teste:3"),
    "lock preserva registros simultâneos de bot e painel");

    // ------------------------------------------------ integrações: duas ordens, mesmas garantias
    const chamadasSpi = [];
    let falhasCancelarSpi = 0;
    const appFalso = {
      enviarAgendamentoEstrito: async (dados, chave) => {
        chamadasSpi.push({ acao: "marcar", dados, chave });
        return `app-${dados.pacienteNome.toLowerCase()}`;
      },
      completarDadosDoPacienteEstrito: async (dados, chave) => {
        chamadasSpi.push({ acao: "completar", dados, chave });
        return { portal: "criado_aguardando_ok" };
      },
      cancelarAgendamentoEstrito: async (id, chave) => {
        chamadasSpi.push({ acao: "cancelar", id, chave });
        if (falhasCancelarSpi++ === 0) throw new Error("SPI indisponível");
        return { ok: true };
      },
    };
    const chamadasGoogle = [];
    let falhasGoogle = 0;
    const googleFalso = {
      criarEventoEstrito: async (dados) => {
        chamadasGoogle.push({ acao: "criar", dados });
        if (falhasGoogle++ === 0) throw new Error("Google indisponível");
        return dados.eventId;
      },
      cancelarEventoEstrito: async (eventId) => {
        chamadasGoogle.push({ acao: "cancelar", eventId });
        return true;
      },
    };
    instante = new Date("2026-08-27T13:00:00.000Z");
    const vinculosSpi = [];
    const vinculosGoogle = [];
    const integracoes = criarIntegracoesDuraveis({
      caminho: path.join(base, "integracoes.json"),
      appAgenda: appFalso,
      googleAgenda: googleFalso,
      logger,
      aoVincularAppAgendamento: async (...args) => vinculosSpi.push(args),
      aoVincularGoogleEvento: async (...args) => vinculosGoogle.push(args),
      opcoesCaixa: {
        agora: () => new Date(instante),
        aleatorio: () => 0.5,
        atrasoBaseMs: 1_000,
      },
    });

    // Dados primeiro, ID depois: completar fica pendente e é acordado pela criação.
    await integracoes.registrarDadosPaciente({
      slotId: "slot-a", email: "ana@exemplo.com", dataNascimento: "2022-03-10",
    });
    resumo = await integracoes.reconciliar();
    eq(resumo.executados, 0, "dados antecipados aguardam o ID sem serem descartados");
    await integracoes.agendarCriacaoSpi({
      slotId: "slot-a",
      dados: {
        pacienteNome: "Lia", responsavelNome: "Ana", telefone: "+551",
        inicio: new Date("2026-09-01T12:00:00Z"), fim: new Date("2026-09-01T13:00:00Z"),
      },
    });
    await integracoes.reconciliar();
    const completarA = chamadasSpi.find((c) => c.acao === "completar" && c.dados.email === "ana@exemplo.com");
    ok(!!completarA, "dados antecipados são enviados assim que o ID existe");
    eq(completarA.dados.appAgendamentoId, "app-lia", "completar usa o vínculo retornado pela criação");
    ok(vinculosSpi.some(([slot, id]) => slot === "slot-a" && id === "app-lia"),
      "callback permite ao chamador guardar o ID no agendamento local");

    // ID primeiro, dados depois: o vínculo persistido também resolve a ordem inversa.
    await integracoes.registrarVinculoSpi({ slotId: "slot-b", appAgendamentoId: "app-b" });
    await integracoes.reconciliar();
    await integracoes.registrarDadosPaciente({ slotId: "slot-b", email: "bia@exemplo.com" });
    await integracoes.reconciliar();
    const completarB = chamadasSpi.find((c) => c.acao === "completar" && c.dados.email === "bia@exemplo.com");
    eq(completarB.dados.appAgendamentoId, "app-b", "ordem inversa também envia para o agendamento certo");

    // Dado adicional posterior reabre uma nova revisão da mesma operação.
    await integracoes.registrarDadosPaciente({ slotId: "slot-b", dataNascimento: "2021-01-02" });
    await integracoes.reconciliar();
    const completarB2 = chamadasSpi.filter((c) => c.acao === "completar" && c.dados.appAgendamentoId === "app-b").at(-1);
    eq(completarB2.dados.dataNascimento, "2021-01-02", "nascimento posterior não some após e-mail já concluído");
    ok(/:v\d+$/.test(completarB2.chave), "SPI recebe chave idempotente versionada");

    // Cancelar registra a referência antes da rede e mantém retry depois da falha.
    await integracoes.agendarCancelamentoSpi({ slotId: "slot-b", appAgendamentoId: "app-b" });
    await integracoes.reconciliar();
    let cancelar = await integracoes.caixa.obter("spi:cancelar:slot-b");
    eq(cancelar.estado, "falhou", "falha no cancelamento SPI permanece na caixa");
    eq(cancelar.dados.appAgendamentoId, "app-b", "referência remota não é perdida");
    instante = new Date(instante.getTime() + 1_001);
    await integracoes.reconciliar();
    cancelar = await integracoes.caixa.obter("spi:cancelar:slot-b");
    eq(cancelar.estado, "concluido", "cancelamento SPI é reaplicado após backoff");

    // Google usa um ID determinístico e conserva o trabalho após uma falha.
    const eventId = eventIdGoogleDoSlot("slot-g");
    ok(/^carla[0-9a-f]{48}$/.test(eventId), "ID do Google é determinístico e válido");
    const agendadoGoogle = await integracoes.agendarCriacaoGoogle({
      slotId: "slot-g",
      inicio: new Date("2026-09-02T12:00:00Z"),
      fim: new Date("2026-09-02T13:00:00Z"),
      titulo: "Consulta",
      descricao: "Teste",
    });
    eq(agendadoGoogle.eventId, eventId, "chamador conhece o ID antes da tentativa remota");
    await integracoes.reconciliar();
    let criarGoogle = await integracoes.caixa.obter("google:criar:slot-g");
    eq(criarGoogle.estado, "falhou", "falha ao criar no Google fica pendente");
    instante = new Date(instante.getTime() + 1_001);
    await integracoes.reconciliar();
    criarGoogle = await integracoes.caixa.obter("google:criar:slot-g");
    eq(criarGoogle.estado, "concluido", "criação Google é retomada");
    eq(chamadasGoogle[0].dados.eventId, chamadasGoogle[1].dados.eventId,
      "retries usam o mesmo ID e não criam evento duplicado");
    ok(vinculosGoogle.some(([slot, id]) => slot === "slot-g" && id === eventId),
      "callback permite guardar o ID Google localmente");

    await integracoes.agendarCancelamentoGoogle({ slotId: "slot-g", eventId });
    await integracoes.reconciliar();
    const cancelarGoogle = await integracoes.caixa.obter(`google:cancelar:${eventId}`);
    eq(cancelarGoogle.estado, "concluido", "cancelamento Google também é durável e reconciliável");
    ok(chamadasGoogle.some((c) => c.acao === "cancelar" && c.eventId === eventId),
      "cancelamento remoto recebe a referência persistida");

    // Se o cancelamento chega enquanto a criação ainda está pendente, ele espera a criação
    // terminar e a desfaz em seguida; nunca conclui 404 para depois deixar nascer um fantasma.
    const inicioOrdem = chamadasGoogle.length;
    const futuro = await integracoes.agendarCriacaoGoogle({
      slotId: "slot-h",
      inicio: new Date("2026-09-03T12:00:00Z"),
      fim: new Date("2026-09-03T13:00:00Z"),
      titulo: "Consulta H",
      descricao: "Teste de ordem",
    });
    await integracoes.agendarCancelamentoGoogle({ slotId: "slot-h", eventId: futuro.eventId });
    await integracoes.reconciliar();
    const ordem = chamadasGoogle.slice(inicioOrdem).map((c) => c.acao);
    eq(ordem.join(","), "criar,cancelar", "cancelamento Google aguarda a criação pendente antes de desfazê-la");

    const arquivo = JSON.parse(fs.readFileSync(path.join(base, "integracoes.json"), "utf8"));
    ok(arquivo.efeitos.every((e) => ["pendente", "concluido", "falhou"].includes(e.estado)),
      "arquivo só contém os três estados públicos previstos");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }

  console.log(`\nintegracoes-duraveis: ${passou} passaram, ${falhou} falharam`);
  if (falhou) {
    erros.forEach((erro) => console.log("  FALHOU: " + erro));
    process.exit(1);
  }
})().catch((erro) => {
  console.error(erro && erro.stack || erro);
  process.exit(1);
});
