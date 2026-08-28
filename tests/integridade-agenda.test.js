/*
 * Agenda transacional: estados, expiração, irmãos, horário real e dois processos.
 * Usa uma raiz descartável e nunca encosta em dados reais.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

let passou = 0;
let falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, `${msg} (esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)})`); }

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "carla-agenda-transacional-"));
const RAIZ = path.join(TEMP, "bot");
fs.mkdirSync(path.join(RAIZ, "data"), { recursive: true });
fs.mkdirSync(path.join(RAIZ, "carla-app", "js"), { recursive: true });
fs.copyFileSync(path.join(__dirname, "..", "storage-node.js"), path.join(RAIZ, "storage-node.js"));
fs.copyFileSync(path.join(__dirname, "..", "arquivo-atomico.js"), path.join(RAIZ, "arquivo-atomico.js"));
fs.writeFileSync(path.join(RAIZ, "carla-app", "js", "config.js"), `
global.CARLA_CONFIG = { nomesDiaSemana: ["domingo","segunda","terça","quarta","quinta","sexta","sábado"] };
`);
fs.writeFileSync(path.join(RAIZ, "carla-app", "js", "agenda.js"), `
function toDateStr(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function gerarSlotsPossiveis() {
  return [{ id: "grade-2099-09-10-09:00", date: "2099-09-10", time: "09:00", label: "10/09 às 09:00" }];
}
module.exports = { toDateStr, gerarSlotsPossiveis, formatHora: (h) => h };
`);

// Migração: o JSON preexistente entra no banco sem ser a única cópia recuperável.
fs.writeFileSync(path.join(RAIZ, "data", "agendamentos.json"), JSON.stringify([{
  slotId: "legado-pago", data: "2099-09-01", horario: "10:00", diaLabel: "01/09 às 10:00",
  responsavel: "Ana", crianca: "Lia", telefone: "+5519000000001",
  registradoEm: "2099-01-01T12:00:00.000Z", pago: true,
}], null, 2));

const Storage = require(path.join(RAIZ, "storage-node.js"));
const slot = (id, data, horario) => ({ id, date: data, time: horario, label: `${data} às ${horario}` });

async function processo(codigo, ...args) {
  return new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, ["-e", codigo, RAIZ, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let saida = "", erro = "";
    filho.stdout.on("data", (c) => { saida += c; });
    filho.stderr.on("data", (c) => { erro += c; });
    filho.on("error", reject);
    filho.on("exit", (status) => status === 0 ? resolve(saida.trim()) : reject(new Error(erro || saida || `status ${status}`)));
  });
}

(async () => {
  try {
    // 1. Migração conservadora e estado legado.
    const legado = Storage.acharAgendamentoPorSlot("legado-pago");
    eq(legado.estado, "pago", "1. pago legado migrou como pago");
    eq(legado.agendaSlotId, "legado-pago", "1. migração separa explicitamente a vaga legada");
    ok(fs.readdirSync(path.join(RAIZ, "data")).some((n) => n.startsWith("agendamentos.json.antes-sqlite-")),
      "1. JSON original ganhou cópia anterior à migração");
    ok(fs.existsSync(path.join(RAIZ, "data", "agendamentos.sqlite")), "1. banco transacional foi criado");

    // 2. Reserva expira e deixa de ocupar/ser consulta.
    const expira = new Date("2099-08-01T12:01:00.000Z");
    const reservado = Storage.reservar({
      slot: slot("expira", "2099-08-20", "09:00"), responsavel: "Bia", crianca: "Beto",
      telefone: "+5519000000002", expiraEm: expira.toISOString(),
    });
    eq(reservado.estado, "reservado", "2. reserva nasce reservada");
    eq(reservado.agendaSlotId, "expira", "2. vaga da grade fica registrada separadamente");
    ok(reservado.slotId !== reservado.agendaSlotId, "2. reserva ganha identidade própria");
    eq(reservado.expiresAt, expira.toISOString(), "2. prazo executável foi persistido");
    Storage.definirAppAgendamentoId(reservado.slotId, "spi-expirado");
    Storage.definirGoogleEventId(reservado.slotId, "google-expirado");
    eq(Storage.vencerReservas(new Date("2099-08-01T12:02:00.000Z")), 1, "2. rotina venceu a reserva no prazo");
    eq(Storage.acharAgendamentoPorSlot(reservado.slotId), null, "2. vencida some das consultas ativas");
    eq(Storage.lerTodosAgendamentos().find((a) => a.slotId === reservado.slotId).estado, "vencido",
      "2. vencida permanece no histórico de auditoria");
    eq(Storage.listarVencimentosPendentesDeLimpeza(new Date("2099-08-01T12:02:00.000Z")).map((a) => a.slotId).includes(reservado.slotId), true,
      "2. integração externa consegue descobrir o vencimento");
    ok(Storage.marcarVencimentoSincronizado(reservado.slotId, { google: "cancelado" }), "2. limpeza externa pode ser confirmada");
    eq(Storage.listarVencimentosPendentesDeLimpeza(new Date("2099-08-01T12:02:00.000Z")).some((a) => a.slotId === reservado.slotId), false,
      "2. vencimento sincronizado não volta para a fila");
    ok(!Storage.idsOcupados(new Date("2099-08-01T12:02:00.000Z")).has("expira"), "2. vencida libera o horário");
    eq(Storage.proximaConsultaDoTelefone("+5519000000002", new Date("2099-08-01T12:02:00.000Z")), null,
      "2. vencida não vira próxima consulta");
    const reReservaVencida = Storage.reservar({
      slot: slot("expira", "2099-08-20", "09:00"), responsavel: "Bia", crianca: "Beto",
      telefone: "+5519000000002", expiraEm: "2099-08-20T08:00:00.000Z",
    });
    ok(!!reReservaVencida, "2. a mesma vaga pode ser reservada novamente após vencer");
    ok(reReservaVencida.slotId !== reservado.slotId, "2. nova reserva não reutiliza a identidade vencida");
    eq(reReservaVencida.appAgendamentoId, null, "2. vínculo SPI antigo não vaza para a nova reserva");
    eq(reReservaVencida.googleEventId, null, "2. vínculo Google antigo não vaza para a nova reserva");
    ok(Storage.idsOcupados().has("expira"), "2. ocupação volta a usar o ID da vaga da grade");

    // 3. Lembrete é exclusivo de consulta paga.
    const lembrete = Storage.reservar({
      slot: slot("lembrete", "2099-08-08", "14:00"), responsavel: "Caio", crianca: "Cris",
      telefone: "+5519000000003", expiraEm: "2099-08-08T12:00:00.000Z",
    });
    eq(Storage.agendamentosProntosParaLembrete("2099-08-01", "semanaAntes").length, 0,
      "3. separação sem pagamento não recebe lembrete");
    ok(Storage.marcarPagamento(lembrete.slotId, true), "3. pagamento foi marcado pela identidade da reserva");
    eq(Storage.agendamentosProntosParaLembrete("2099-08-01", "semanaAntes").length, 1,
      "3. consulta paga recebe lembrete");

    // 4. Duplicidade é pelo instante real, e não pelo identificador.
    const primeiro = Storage.reservar({
      slot: slot("grade-x", "2099-08-09", "10:00"), responsavel: "Dani", crianca: "Duda",
      telefone: "+5519000000004", expiraEm: "2099-08-09T09:00:00.000Z",
    });
    const duplicado = Storage.reservar({
      slot: slot("extra-2099-08-09-10:00", "2099-08-09", "10:00"), responsavel: "Eva", crianca: "Eli",
      telefone: "+5519000000005", expiraEm: "2099-08-09T09:00:00.000Z",
    });
    ok(!!primeiro, "4. primeira reserva do instante entrou");
    eq(primeiro.agendaSlotId, "grade-x", "4. identidade da vaga original foi preservada");
    eq(duplicado, false, "4. outro id no mesmo instante foi recusado");

    fs.writeFileSync(path.join(RAIZ, "data", "horarios-extras.json"), JSON.stringify([{ data: "2099-09-10", hora: "09:00" }]));
    eq(Storage.slotsPossiveisComExtras(new Date("2099-01-01T00:00:00")).filter((s) => s.date === "2099-09-10" && s.time === "09:00").length, 1,
      "4. grade e extra iguais aparecem uma única vez");

    // 5. Irmãos exigem slotId e não recebem dados um do outro.
    const telIrmaos = "+5519000000006";
    const irma1 = Storage.reservar({ slot: slot("irma-1", "2099-08-11", "09:00"), responsavel: "Fabi", crianca: "Iara", telefone: telIrmaos, expiraEm: "2099-08-10T23:00:00.000Z" });
    const irma2 = Storage.reservar({ slot: slot("irma-2", "2099-08-11", "10:00"), responsavel: "Fabi", crianca: "Iris", telefone: telIrmaos, expiraEm: "2099-08-10T23:00:00.000Z" });
    const ambiguo = Storage.registrarDadosDoPaciente(telIrmaos, { email: "mae@exemplo.com" });
    ok(ambiguo && ambiguo.ambiguo === true, "5. telefone com dois agendamentos não escolhe filho sozinho");
    const gravado = Storage.registrarDadosDoPaciente(telIrmaos, { dataNascimento: "2020-02-02" }, { slotId: irma1.slotId });
    eq(gravado.slotId, irma1.slotId, "5. API por slot devolve o filho correto");
    eq(Storage.acharAgendamentoPorSlot(irma1.slotId).criancaDataNascimento, "2020-02-02", "5. dado entrou no filho escolhido");
    eq(Storage.acharAgendamentoPorSlot(irma2.slotId).criancaDataNascimento, null, "5. outro irmão não foi alterado");

    // 6. Cancelar libera a vaga sem apagar o rastro nem as referências externas.
    Storage.definirAppAgendamentoId(irma2.slotId, "spi-irma-2");
    Storage.definirGoogleEventId(irma2.slotId, "google-irma-2");
    const cancelado = Storage.cancelarAgendamento(irma2.slotId);
    eq(cancelado.estado, "cancelado", "6. cancelamento tem estado formal");
    eq(cancelado.appAgendamentoId, "spi-irma-2", "6. ID do prontuário sobrevive ao cancelamento");
    eq(cancelado.googleEventId, "google-irma-2", "6. ID do Google sobrevive ao cancelamento");
    eq(Storage.acharAgendamentoPorSlot(irma2.slotId), null, "6. cancelado não é consulta ativa");
    eq(Storage.lerTodosAgendamentos().find((a) => a.slotId === irma2.slotId).estado, "cancelado",
      "6. cancelado continua auditável");
    ok(Storage.listarCancelamentosPendentesDeFila().some((a) => a.slotId === irma2.slotId),
      "6. queda antes da fila externa deixa cancelamento recuperável");
    // A criação externa pode terminar depois do clique em cancelar. O vínculo ainda precisa
    // ser persistido no registro inativo para a fila conseguir apagá-lo em seguida.
    Storage.definirGoogleEventId(irma2.slotId, "google-irma-2-tardio");
    eq(Storage.lerTodosAgendamentos().find((a) => a.slotId === irma2.slotId).googleEventId,
      "google-irma-2-tardio", "6. vínculo tardio do Google também é guardado");
    ok(Storage.marcarCancelamentoEnfileirado(irma2.slotId, { spi: true, google: true }),
      "6. enfileiramento externo pode ser confirmado");
    ok(!Storage.listarCancelamentosPendentesDeFila().some((a) => a.slotId === irma2.slotId),
      "6. cancelamento já enfileirado não volta na recuperação");
    const reReservaCancelada = Storage.reservar({
      slot: slot("irma-2", "2099-08-11", "10:00"), responsavel: "Fabi", crianca: "Iris",
      telefone: telIrmaos, expiraEm: "2099-08-10T23:30:00.000Z",
    });
    ok(!!reReservaCancelada, "6. a mesma vaga pode ser reservada novamente após cancelamento");
    ok(reReservaCancelada.slotId !== irma2.slotId, "6. re-reserva cancelada ganha nova identidade");
    eq(reReservaCancelada.agendaSlotId, irma2.agendaSlotId, "6. só a identidade da vaga é compartilhada");
    eq(reReservaCancelada.appAgendamentoId, null, "6. novo agendamento não herda ID do SPI");
    eq(reReservaCancelada.googleEventId, null, "6. novo agendamento não herda ID do Google");
    ok(`spi:marcar:${reReservaCancelada.slotId}` !== `spi:marcar:${irma2.slotId}`,
      "6. nova reserva produz outra chave idempotente para efeitos externos");

    // 7. Dois processos disputando o mesmo instante: exatamente um ganha.
    const reservarConcorrente = `
      const S=require(require('path').join(process.argv[1],'storage-node.js'));
      const n=process.argv[2];
      const r=S.reservar({slot:{id:'corr-'+n,date:'2099-08-12',time:'11:00',label:'x'},responsavel:'R',crianca:'C'+n,telefone:'+5519'+n,expiraEm:'2099-08-12T10:00:00.000Z'});
      process.stdout.write(r ? '1' : '0');
    `;
    const disputas = await Promise.all(Array.from({ length: 8 }, (_, i) => processo(reservarConcorrente, String(i))));
    eq(disputas.filter((x) => x === "1").length, 1, "7. concorrência aceita uma única reserva real");

    // 8. Atualizações concorrentes no mesmo registro não se apagam.
    const reservaCampos = Storage.reservar({ slot: slot("campos", "2099-08-13", "15:00"), responsavel: "Gui", crianca: "Gabi", telefone: "+5519000000007", expiraEm: "2099-08-13T12:00:00.000Z" });
    const marcarCampo = `
      const S=require(require('path').join(process.argv[1],'storage-node.js'));
      const id=process.argv[2], tipo=process.argv[3];
      const ok=tipo==='portal' ? S.marcarPortalAvisado(id) : S.marcarGuiaAvisado(id);
      process.stdout.write(ok ? '1' : '0');
    `;
    await Promise.all([
      processo(marcarCampo, reservaCampos.slotId, "portal"),
      processo(marcarCampo, reservaCampos.slotId, "guia"),
    ]);
    const campos = Storage.acharAgendamentoPorSlot(reservaCampos.slotId);
    ok(!!campos.portalAvisadoEm, "8. atualização do portal permaneceu");
    ok(!!campos.guiaAvisadoEm, "8. atualização do guia permaneceu");

    // 9. Pagamento repetido é idempotente; desfazer cancela uma confirmação ainda na fila.
    const reservaPagamento = Storage.reservar({
      slot: slot("pagamento", "2099-08-14", "15:00"), responsavel: "Helena", crianca: "Hugo",
      telefone: "+5519000000008", expiraEm: "2099-08-14T12:00:00.000Z",
    });
    let alteracao = Storage.alterarPagamento(reservaPagamento.slotId, true);
    ok(alteracao.ok && alteracao.alterado, "9. primeiro clique em pago altera o estado");
    const pagoEm = alteracao.agendamento.pagoEm;
    alteracao = Storage.alterarPagamento(reservaPagamento.slotId, true);
    ok(alteracao.ok && !alteracao.alterado, "9. clique repetido é sucesso sem nova mutação");
    eq(alteracao.agendamento.pagoEm, pagoEm, "9. clique repetido não reescreve a hora do pagamento");
    Storage.registrarMensagemPendente({
      telefone: reservaPagamento.telefone,
      jid: "5519000000008@s.whatsapp.net",
      texto: "Pagamento confirmado",
      chaveIdempotencia: `pagamento:${reservaPagamento.slotId}`,
    });
    Storage.marcarPagamentoAvisado(reservaPagamento.slotId);
    alteracao = Storage.alterarPagamento(reservaPagamento.slotId, false);
    ok(alteracao.ok && alteracao.alterado, "9. desfazer pagamento altera o estado");
    eq(alteracao.agendamento.pagamentoAvisadoEm, null, "9. desfazer limpa a marca de aviso anterior");
    eq(Storage.listarMensagensPendentes().some((m) => m.chaveIdempotencia === `pagamento:${reservaPagamento.slotId}`), false,
      "9. confirmação ainda não entregue sai da caixa ao desfazer");
    alteracao = Storage.alterarPagamento(reservaPagamento.slotId, true);
    ok(alteracao.ok && alteracao.alterado && !alteracao.agendamento.pagamentoAvisadoEm,
      "9. um pagamento futuro pode gerar uma confirmação nova");

    // 10. Bot e painel atualizando os JSONs compartilhados ao mesmo tempo não apagam
    // telefones diferentes. A troca atômica protege contra arquivo pela metade; este teste
    // exige também o lock que impede o último escritor de sobrescrever os demais.
    const atualizarJsonConcorrente = `
      const S=require(require('path').join(process.argv[1],'storage-node.js'));
      const n=process.argv[2];
      for(let i=0;i<15;i++){
        const telefone='+5518'+n.padStart(2,'0')+String(i).padStart(8,'0');
        S.salvarSessao(telefone,{telefone,historico:[],ultimaAtividade:new Date().toISOString()});
        S.registrarAlertaUrgencia({telefone,mensagem:'teste',tipo:'teste'});
        S.guardarDadosPendentes(telefone,{email:'familia'+n+'-'+i+'@example.com'});
        S.registrarContatoWhatsapp(telefone,{pushName:'Contato '+n+' '+i});
        S.silenciarContato(telefone);
      }
      process.stdout.write('1');
    `;
    await Promise.all(Array.from({ length: 8 }, (_, i) => processo(atualizarJsonConcorrente, String(i))));
    const sessoesConcorrentes = JSON.parse(fs.readFileSync(path.join(RAIZ, "data", "sessoes.json"), "utf8"));
    eq(Object.keys(sessoesConcorrentes).filter((t) => t.startsWith("+5518")).length, 120,
      "10. 120 sessões concorrentes permaneceram no arquivo");
    eq(Storage.lerAlertas().filter((a) => a.tipo === "teste").length, 120,
      "10. 120 alertas concorrentes permaneceram no arquivo");
    const dadosConcorrentes = JSON.parse(fs.readFileSync(path.join(RAIZ, "data", "dados-pendentes.json"), "utf8"));
    eq(Object.keys(dadosConcorrentes).filter((t) => t.startsWith("+5518")).length, 120,
      "10. 120 conjuntos de dados pendentes permaneceram no arquivo");
    const contatosConcorrentes = JSON.parse(fs.readFileSync(path.join(RAIZ, "data", "contatos-whatsapp.json"), "utf8"));
    eq(Object.keys(contatosConcorrentes).filter((t) => t.startsWith("+5518")).length, 120,
      "10. 120 contatos concorrentes permaneceram no arquivo");
    eq(Storage.lerContatosSilenciados().filter((t) => t.startsWith("+5518")).length, 120,
      "10. 120 silenciamentos concorrentes permaneceram no arquivo");
  } catch (erro) {
    falhou++;
    erros.push(erro && erro.stack ? erro.stack : String(erro));
  } finally {
    Storage._fecharBancoAgendamentosParaTeste();
    fs.rmSync(TEMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

  console.log(erros.map((e) => "  FALHA " + e).join("\n"));
  console.log(`integridade-agenda: ${passou} passaram, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
})();
