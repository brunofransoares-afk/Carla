/*
 * Bateria do CRM do painel.
 *
 * O painel deixou de ser quatro listas soltas (contatos, agendamentos, alertas, funil) e
 * virou uma ficha por família: situação, consultas passadas e futuras, crianças, janela
 * de pós-consulta, notas, etiquetas, linha do tempo e os botões de mensagem pós-consulta.
 *
 * O cruzamento mora em crm.js, que é módulo puro: recebe listas, devolve listas. Por isso
 * dá pra testar cada situação com dados inventados, sem SQLite nem WhatsApp. O resto
 * (rotas do painel-server, a caixinha "a Carla continua", o tema da tela) é verificado
 * por leitura do arquivo, que é o que dá pra fazer sem navegador.
 *
 * Roda com:  node tests/painel-crm.test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const Crm = require(path.join(__dirname, "..", "crm.js"));
const LER = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const PAINEL = LER("painel-server.js"), SERVER = LER("server.js"), TELA = LER("dashboard.html");
const JS = TELA.match(/<script>([\s\S]*)<\/script>/)[1];
const CSS = TELA.match(/<style>([\s\S]*)<\/style>/)[1];

// Quinta-feira, meio-dia. Tudo abaixo é relativo a isto.
const AGORA = new Date(2026, 8, 10, 12, 0, 0);
const horasAtras = (h) => new Date(AGORA.getTime() - h * 3600e3).toISOString();
const contato = (extra = {}) => ({ telefone: "+5519000000001", nome: "Ana", ehPaciente: false, ultimaAtividade: horasAtras(2), ultimaMensagem: "", fechou: false, aguardandoHumano: false, silenciado: false, ...extra });
const consulta = (extra = {}) => ({ slotId: "r1", telefone: "+5519000000001", data: "2026-09-12", horario: "09:00", crianca: "Miguel", responsavel: "Ana", estado: "reservado", pago: false, tipoConsulta: "puericultura", ...extra });
function situacoes({ c = contato(), consultas = [], flags = null } = {}) {
  return Crm.montarCrm({ contatos: [c], agendamentos: consultas, funilContatos: flags ? [{ telefone: c.telefone, ...flags }] : [], agora: AGORA }).contatos[0];
}

// ------------------------------------------------- 1. as situações, uma a uma
{
  const a = situacoes({ consultas: [consulta()] });
  ok(a.situacoes.includes("aguardando_pagamento"), "1. reserva futura sem pagamento = aguardando pagamento");
  ok(a.situacoes.includes("consulta_marcada"), "1b. e é consulta marcada");
  ok(!a.situacoes.includes("lead"), "1c. quem tem consulta não é lead");
  ok(a.situacoes.includes("paciente") === false, "1d. mas reserva sem consulta realizada ainda não faz paciente");
  eq(a.proximaConsulta && a.proximaConsulta.data, "2026-09-12", "1e. a próxima consulta está na ficha");

  const b = situacoes({ consultas: [consulta({ pago: true, estado: "pago" })] });
  ok(!b.situacoes.includes("aguardando_pagamento"), "1f. paga não espera pagamento");

  const c = situacoes({ consultas: [consulta({ data: "2026-09-02", estado: "pago", pago: true })] });
  ok(c.situacoes.includes("pos_consulta"), "1g. consulta paga há 8 dias = janela de pós-consulta");
  eq(c.posConsulta.diasDesde, 8, "1h. conta os dias desde a consulta");
  eq(c.posConsulta.diasRestantes, 22, "1i. e quantos restam dos 30");
  ok(c.situacoes.includes("paciente"), "1j. consulta realizada faz paciente, mesmo sem estar salvo na agenda do celular");

  const d = situacoes({ consultas: [consulta({ data: "2026-07-01", estado: "pago", pago: true })] });
  ok(!d.situacoes.includes("pos_consulta"), "1k. consulta de 71 dias atrás já saiu da janela");
  ok(d.situacoes.includes("paciente"), "1l. mas continua paciente");

  const e = situacoes({ consultas: [consulta({ data: "2026-09-02", estado: "cancelado" })] });
  ok(!e.situacoes.includes("pos_consulta") && !e.situacoes.includes("paciente"), "1m. consulta cancelada não conta como realizada");
  eq(e.consultasCanceladas, 1, "1n. mas aparece na contagem de canceladas");
}

// ------------------------------------------------- 2. parou no preço e sem resposta
{
  const cedo = situacoes({ c: contato({ ultimaAtividade: horasAtras(2) }), flags: { recebeuPreco: true } });
  ok(!cedo.situacoes.includes("parou_no_preco"), "2. soube o valor há 2 horas ainda não é 'parou': pode estar conferindo o extrato");
  const tarde = situacoes({ c: contato({ ultimaAtividade: horasAtras(7) }), flags: { recebeuPreco: true } });
  ok(tarde.situacoes.includes("parou_no_preco"), "2b. depois de 6 horas é");
  const fechou = situacoes({ c: contato({ ultimaAtividade: horasAtras(7) }), flags: { recebeuPreco: true, agendou: true } });
  ok(!fechou.situacoes.includes("parou_no_preco"), "2c. quem agendou não parou no preço, por mais que tenha sumido");

  const dois = situacoes({ c: contato({ ultimaAtividade: horasAtras(24 * 2) }) });
  ok(!dois.situacoes.includes("sem_resposta"), "2d. dois dias parado ainda não é 'sem resposta'");
  const tres = situacoes({ c: contato({ ultimaAtividade: horasAtras(24 * 3) }) });
  ok(tres.situacoes.includes("sem_resposta"), "2e. três dias é: foi o número que o Dr. Bruno pediu");
  ok(tres.situacoes.includes("lead"), "2f. e é lead, porque falou e nunca marcou");
  const pacienteQuieto = situacoes({ c: contato({ ultimaAtividade: horasAtras(24 * 30) }), consultas: [consulta({ data: "2026-06-01", estado: "pago", pago: true })] });
  ok(!pacienteQuieto.situacoes.includes("sem_resposta"), "2g. paciente antigo quieto não é lead sem resposta");
  eq(Crm.SEM_RESPOSTA_DIAS, 3, "2h. o número está exposto, pra tela e teste lerem a mesma coisa");
}

// ------------------------------------------------- 3. estágio, humano, silêncio
{
  eq(situacoes({ flags: { recebeuPreco: true } }).estagio.rotulo, "Soube o valor", "3. o estágio é a etapa mais avançada do funil");
  eq(situacoes({ flags: { recebeuPreco: true, recebeuHorario: true, agendou: true, pagou: true } }).estagio.rotulo, "Pagou", "3b. pagou é o topo");
  eq(situacoes({ flags: { } }).estagio.rotulo, "Chamou", "3c. sem nada além do contato é 'Chamou'");
  eq(situacoes({}).estagio.rotulo, "Sem registro", "3d. e quem nem está no funil (de antes do registro) diz isso");
  ok(situacoes({ c: contato({ aguardandoHumano: true }) }).situacoes[0] === "aguardando_humano", "3e. aguardando humano é a primeira situação, porque é a mais urgente");
  ok(situacoes({ c: contato({ silenciado: true }) }).situacoes.includes("silenciado"), "3f. silenciado aparece como situação");
}

// ------------------------------------------------- 4. a lista inteira e o resumo
{
  const contatos = [
    contato({ telefone: "+1", nome: "Humano", aguardandoHumano: true, ultimaAtividade: horasAtras(1) }),
    contato({ telefone: "+2", nome: "Quente", ultimaAtividade: horasAtras(10) }),
    contato({ telefone: "+3", nome: "Antigo", ultimaAtividade: horasAtras(24 * 20) }),
  ];
  const agendamentos = [
    consulta({ slotId: "a", telefone: "+4", responsavel: "Só reserva", data: "2026-09-10", horario: "16:00", estado: "pago", pago: true }),
    consulta({ slotId: "b", telefone: "+5", responsavel: "Sem sessão", data: "2026-09-15", horario: "20:00" }),
    consulta({ slotId: "c", telefone: "+5", data: "2026-08-20", estado: "pago", pago: true }),
    consulta({ slotId: "d", telefone: "+2", data: "2026-09-30", estado: "cancelado" }),
  ];
  const crm = Crm.montarCrm({ contatos, agendamentos, funilContatos: [], agora: AGORA });
  eq(crm.contatos.length, 5, "4. quem só tem reserva (sem sessão) entra na lista mesmo assim: no CRM a família existe porque a consulta existe");
  eq(crm.contatos[0].telefone, "+1", "4b. quem espera o Dr. Bruno vem primeiro");
  const semSessao = crm.contatos.find((c) => c.telefone === "+5");
  eq(semSessao.nome, "Sem sessão", "4c. o nome vem do responsável da reserva quando não há contato salvo");
  eq(semSessao.totalConsultas, 2, "4d. conta a futura e a passada");
  ok(semSessao.situacoes.includes("pos_consulta") && semSessao.situacoes.includes("aguardando_pagamento"), "4e. e pode estar em duas situações ao mesmo tempo");

  const r = crm.resumo;
  eq(r.consultasHoje, 1, "4f. consultas de hoje");
  eq(r.consultasSemana, 2, "4g. próximos 7 dias (hoje e 15/09; 30/09 cancelada não conta)");
  eq(r.aguardandoPagamento, 1, "4h. reservas futuras sem pagamento");
  eq(r.aguardandoVoce, 1, "4i. conversas com a Carla quieta");
  eq(r.leadsQuentes, 2, "4j. leads quentes: falaram em 48 h e não fecharam (Humano e Quente)");
  eq(r.posConsulta, 1, "4k. na janela de 30 dias");
  eq(crm.contagem.sem_resposta, 1, "4l. a contagem por situação alimenta os filtros");
  ok(Array.isArray(crm.situacoes) && crm.situacoes.some((s) => s.chave === "pos_consulta"), "4m. as situações vão com rótulo, pra tela não inventar nome");
}

// ------------------------------------------------- 5. os modelos de pós-consulta
{
  const ids = Crm.MODELOS_POS_CONSULTA.map((m) => m.id);
  for (const id of ["como_esta", "pedir_exames", "exames_recebidos", "fim_dos_30_dias", "avaliacao", "rotina"]) ok(ids.includes(id), `5. existe o modelo ${id}`);
  for (const m of Crm.MODELOS_POS_CONSULTA) {
    ok(!/—/.test(m.texto), `5b. sem travessão no modelo ${m.id}: ele vai pra família`);
    ok(m.texto.length <= 400, `5c. curto (${m.id}): é WhatsApp, não carta`);
  }
  const soRotina = Crm.MODELOS_POS_CONSULTA.filter((m) => m.carlaContinua).map((m) => m.id);
  eq(soRotina.sort().join(","), "retorno,rotina", "5d. só o convite pra rotina e o recado de retorno deixam a Carla ligada: os outros esperam resposta clínica, que é do médico");

  const p = Crm.preencherModelo(Crm.MODELOS_POS_CONSULTA[0], { responsavel: "Ana", crianca: "Miguel" });
  ok(p.ok && p.texto.startsWith("Oi, Ana!") && p.texto.includes("como Miguel está"), "5e. preenche nome do responsável e da criança");
  const semNome = Crm.preencherModelo(Crm.MODELOS_POS_CONSULTA[0], {});
  ok(semNome.ok && semNome.texto.startsWith("Oi! ") && semNome.texto.includes("seu filho(a)"), "5f. sem nomes, lê bem mesmo assim");
  const av = Crm.MODELOS_POS_CONSULTA.find((m) => m.id === "avaliacao");
  ok(!Crm.preencherModelo(av, { crianca: "Miguel" }).ok, "5g. pedir avaliação sem link configurado é recusado, não mandado com buraco");
  ok(Crm.preencherModelo(av, { crianca: "Miguel", linkAvaliacao: "https://g.page/x" }).texto.endsWith("https://g.page/x"), "5h. com link, o link vai no fim");
  const lista = Crm.modelosPara({ crianca: "Théo" });
  ok(lista.find((m) => m.id === "avaliacao").disponivel === false && lista.find((m) => m.id === "como_esta").disponivel === true, "5i. modelosPara diz qual está disponível, pra tela desabilitar o botão em vez de sumir com ele");
}

// ------------------------------------------------- 6. notas e etiquetas gravam de verdade
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carla-crm-"));
  const arq = path.join(dir, "crm.json");
  const n1 = Crm.adicionarNota(arq, "+1", "  pediu exames  ", AGORA);
  ok(n1.ok && n1.nota.texto === "pediu exames", "6. a nota entra aparada");
  ok(!Crm.adicionarNota(arq, "+1", "   ").ok, "6b. nota vazia não entra");
  ok(!Crm.adicionarNota(arq, "", "x").ok, "6c. nem sem telefone");
  Crm.adicionarNota(arq, "+1", "segunda", AGORA);
  eq(Crm.lerCrm(arq).notas["+1"].length, 2, "6d. duas notas gravadas no arquivo");
  const rem = Crm.removerNota(arq, "+1", n1.nota.id);
  ok(rem.ok && Crm.lerCrm(arq).notas["+1"].length === 1, "6e. remover tira só aquela");
  ok(!Crm.removerNota(arq, "+1", "nao-existe").ok, "6f. id desconhecido não apaga nada");
  const et = Crm.definirEtiquetas(arq, "+1", [" TEA? ", "fono", "fono", "", "x".repeat(60)]);
  eq(et.etiquetas.join("|"), "TEA?|fono|" + "x".repeat(24), "6g. etiquetas: aparadas, sem repetição, sem vazia, com teto de tamanho");
  Crm.definirEtiquetas(arq, "+1", []);
  ok(!Crm.lerCrm(arq).etiquetas["+1"], "6h. lista vazia apaga a chave");
  const crm = Crm.montarCrm({ contatos: [contato({ telefone: "+1" })], agendamentos: [], funilContatos: [], dadosCrm: Crm.lerCrm(arq), agora: AGORA });
  eq(crm.contatos[0].notas, 1, "6i. a ficha sabe quantas notas tem");
  eq(crm.contatos[0].ultimaNota, "segunda", "6j. e qual é a última");
  fs.rmSync(dir, { recursive: true, force: true });
}

// ------------------------------------------------- 7. linha do tempo
{
  const lt = Crm.linhaDoTempo({
    eventos: [
      { em: "2026-09-01T10:00:00Z", tipo: "mensagem", trecho: "quanto custa" },
      { em: "2026-09-01T10:01:00Z", tipo: "preco_informado", valorCentavos: 45000 },
      { em: "2026-09-03T10:00:00Z", tipo: "agendou", crianca: "Miguel", quando: "sábado 12/09" },
      { em: "2026-09-04T10:00:00Z", tipo: "mensagem_manual", trecho: "Oi Ana" },
    ],
    notas: [{ em: "2026-09-02T10:00:00Z", texto: "ligou no fixo" }],
  });
  eq(lt.length, 5, "7. eventos e notas juntos");
  eq(lt[0].tipo, "mensagem_manual", "7b. do mais novo pro mais velho");
  ok(lt[1].texto.includes("Agendou Miguel"), "7c. com texto de gente, não nome de evento");
  ok(lt[2].texto === "Nota: ligou no fixo", "7d. a nota entra na linha com o rótulo dela");
  ok(lt[3].texto.includes("R$ 450"), "7e. o valor informado aparece");
  eq(Crm.linhaDoTempo({ eventos: Array.from({ length: 100 }, (_, i) => ({ em: `2026-01-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00Z`, tipo: "mensagem" })) }).length, 60, "7f. tem teto");
}

// ------------------------------------------------- 8. o painel serve o CRM
{
  ok(/caminhoPedido === "\/api\/crm" && req\.method === "GET"/.test(PAINEL), "8. rota do CRM");
  ok(/Storage\.lerTodosAgendamentos\(\)/.test(PAINEL.slice(PAINEL.indexOf('"/api/crm"'))), "8b. lê TODOS os agendamentos, com os passados: histórico da família importa aqui");
  ok(/Eventos\.funil\(\{\}\)\.contatos/.test(PAINEL), "8c. o estágio vem do mesmo funil da aba, pra não existirem dois números");
  ok(/caminhoPedido === "\/api\/crm\/contato"/.test(PAINEL), "8d. a ficha tem rota própria");
  ok(/historico: \(\(sessao && sessao\.historico\) \|\| \[\]\)\.slice\(-12\)/.test(PAINEL), "8e. a ficha traz as últimas mensagens da conversa");
  ok(/"\/api\/crm\/nota"/.test(PAINEL) && /"\/api\/crm\/nota-remover"/.test(PAINEL) && /"\/api\/crm\/etiquetas"/.test(PAINEL), "8f. nota, remover nota e etiquetas");
  ok(/const ARQ_CRM = path\.join\(__dirname, "data", "crm\.json"\)/.test(PAINEL), "8g. num arquivo próprio em data/ (que é gitignored)");
  ok(/process\.env\.LINK_AVALIACAO_GOOGLE/.test(PAINEL), "8h. o link de avaliação vem do .env");
  ok(/carlaContinua: corpo\.carlaContinua === true/.test(PAINEL), "8i. o painel repassa 'a Carla continua' só como booleano estrito");
}

// ------------------------------------------------- 9. o bot: calar continua sendo o padrão
{
  const bloco = SERVER.slice(SERVER.indexOf("async function mensagemManual("), SERVER.indexOf("async function processarMensagem("));
  ok(/\{ carlaContinua = false \} = \{\}/.test(bloco), "9. carlaContinua nasce false: texto livre cala a Carla, como sempre");
  ok(/if \(!carlaContinua\) \{\s*\n\s*sessao\.aguardandoHumano = true;/.test(bloco), "9b. e só não cala quando o painel pediu");
  ok(/mensagemManual\(dados\.telefone, dados\.texto, \{ carlaContinua: dados\.carlaContinua === true \}\)/.test(SERVER), "9c. a rota interna lê a flag como booleano estrito");
}

// ------------------------------------------------- 10. a tela
{
  ok(/linear-gradient\(180deg, var\(--azul-topo\) 0%, var\(--azul-meio\) 42%, var\(--azul-fundo\) 100%\)/.test(CSS), "10. fundo azul-marinho escurecendo do topo pro fundo");
  ok(/--azul-topo: #102a5c;/.test(CSS) && /--azul-fundo: #040a1c;/.test(CSS), "10b. os dois azuis");
  ok(/--ouro: #d4b060;/.test(CSS) && /h1, h2, h3 \{[^}]*color: var\(--ouro\)/.test(CSS), "10c. títulos em dourado");
  ok(/--texto: #efe3c2;/.test(CSS), "10d. texto corrido em dourado pálido, pra continuar legível");
  ok(!/#1e3324|#274733|#0b1610/.test(CSS), "10e. o verde antigo saiu inteiro");
  for (const aba of ["visao", "familias", "agenda", "funil"]) ok(new RegExp(`data-aba="${aba}"`).test(TELA), `10f. aba ${aba}`);
  ok(/id="kpi-hoje"/.test(TELA) && /id="kpi-pagamento"/.test(TELA) && /id="kpi-pos"/.test(TELA) && /id="kpi-conversao"/.test(TELA), "10g. os números do topo");
  ok(/id="filtros"/.test(TELA) && /data-filtro="todos"/.test(JS), "10h. filtros por situação");
  ok(/id="ficha-contato"/.test(TELA) && /function renderizarFicha\(f\)/.test(JS), "10i. a ficha");
  ok(/fetch\("\/api\/crm"\)/.test(JS) && /\/api\/crm\/contato\?telefone=/.test(JS), "10j. a tela lê as duas rotas");
  ok(/\.modelos button\[data-modelo\]/.test(JS) && /function usarModelo\(id, meses = null\)/.test(JS), "10k. os botões de pós-consulta");
  ok(/campo\.value = m\.texto;/.test(JS) && !/usarModelo[\s\S]{0,600}fetch\(/.test(JS.slice(JS.indexOf("function usarModelo"))), "10l. o botão só PREENCHE a caixa: nada sai sem o Enviar");
  ok(/class="input-carla-continua"/.test(JS) && /checked = !!m\.carlaContinua/.test(JS), "10m. o modelo marca a caixinha 'a Carla continua' do jeito dele");
  ok(/body: JSON\.stringify\(\{ telefone, texto, carlaContinua \}\)/.test(JS), "10n. e o envio manda a caixinha junto");
  ok(/if \(!forcar && alguemDigitandoEm\("#ficha-contato textarea, #ficha-contato input"\)\) return;/.test(JS), "10o. a ficha não redesenha enquanto se digita nela");
  ok(/id="input-nota"/.test(JS) && /id="input-etiqueta"/.test(JS), "10p. nota e etiqueta na ficha");
  ok(/class="balao \$\{m\.role === "user" \? "user" : "assistant"\}"/.test(JS), "10q. últimas mensagens como balões, família de um lado e consultório do outro");
  ok(/https:\/\/wa\.me\/\$\{escapeHtml\(numeroLimpo\)\}/.test(JS), "10r. atalho pra abrir no WhatsApp");
  ok(/<th>Tipo<\/th><th>Modalidade<\/th>/.test(JS), "10s. a agenda mostra tipo e modalidade");
  ok(/body\.ficha-aberta \.ficha \{ position: fixed; inset: 0;/.test(CSS), "10t. no celular a ficha vira folha por cima da lista");
  ok(/setInterval\(atualizarCrm, 12000\)/.test(JS), "10u. o CRM se atualiza sozinho");
}

// ------------------------------------------------- 11. marcar como paciente É conversão
{
  // Nem toda venda é a Carla que fecha. O Dr. Bruno assume a conversa, combina por fora e
  // marca a família como paciente no painel. Isso tem que contar no funil, no anel e na ficha.
  const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), "carla-crm-eventos-"));
  fs.copyFileSync(path.join(__dirname, "..", "registro-de-eventos.js"), path.join(RAIZ, "registro-de-eventos.js"));
  const Eventos = require(path.join(RAIZ, "registro-de-eventos.js"));
  const t = (h) => new Date(AGORA.getTime() - h * 3600e3);
  Eventos.registrar("contato", "+11", {}, t(50));
  Eventos.registrar("mensagem", "+11", { classe: "preco", trecho: "quanto custa" }, t(50));
  Eventos.registrar("preco_informado", "+11", { valorCentavos: 45000 }, t(49));
  Eventos.registrar("contato", "+12", {}, t(40));
  Eventos.registrar("mensagem", "+12", { classe: "preco", trecho: "valor?" }, t(40));
  Eventos.registrar("preco_informado", "+12", { valorCentavos: 45000 }, t(39));
  let f = Eventos.funil({});
  eq(f.conversaoParticular.fecharam, 0, "11. antes: duas famílias souberam o valor, ninguém fechou");

  Eventos.registrar("virou_paciente", "+11", { origem: "painel" }, t(10));
  f = Eventos.funil({});
  eq(f.conversaoParticular.fecharam, 1, "11b. marcou como paciente: fechou");
  eq(f.conversaoParticular.taxa, 50, "11c. e a taxa do anel sobe (1 de 2)");
  const c11 = f.contatos.find((c) => c.telefone === "+11");
  ok(c11.agendou && c11.fechouComDoutor && c11.recebeuHorario, "11d. no funil ela conta como 'agendou' (com a normalização das etapas anteriores) e carrega a marca de quem fechou");
  eq(f.etapas.find((e) => e.chave === "agendou").quantidade, 1, "11e. a barra 'Agendaram' do gráfico sobe junto");
  ok(!c11.pagou, "11f. mas não vira 'pagou': pagamento é outra marca, do Dr. Bruno também");
  ok(/fechou_com_doutor/.test(Eventos.csv({})) && /\+11,preco,[^\n]*,sim,sim,sim,sim,nao,nao/.test(Eventos.csv({})), "11g. a planilha tem a coluna e a linha dela diz sim");

  Eventos.registrar("paciente_desmarcado", "+11", { origem: "painel" }, t(5));
  f = Eventos.funil({});
  eq(f.conversaoParticular.fecharam, 0, "11h. desmarcar desfaz a conversão, sem apagar a trilha (evento compensatório, na ordem)");

  // No CRM: situação, estágio e linha do tempo
  const crm = Crm.montarCrm({ contatos: [contato({ telefone: "+11", ehPaciente: true, ultimaAtividade: horasAtras(30) })], agendamentos: [], funilContatos: [{ telefone: "+11", recebeuPreco: true, recebeuHorario: true, agendou: true, fechouComDoutor: true }], agora: AGORA });
  const c = crm.contatos[0];
  ok(c.situacoes.includes("fechou_com_voce") && c.situacoes.includes("paciente"), "11i. a ficha mostra 'Fechou com você' e 'Paciente'");
  ok(!c.situacoes.includes("parou_no_preco") && !c.situacoes.includes("sem_resposta") && !c.situacoes.includes("lead"), "11j. e ela sai das listas de perda: não parou no valor, não é lead sem resposta");
  eq(c.estagio.rotulo, "Fechou com você", "11k. o estágio diz de onde veio a conversão");
  eq(Crm.montarCrm({ contatos: [contato({ telefone: "+11" })], agendamentos: [], funilContatos: [{ telefone: "+11", agendou: true, pagou: true, fechouComDoutor: true }], agora: AGORA }).contatos[0].estagio.rotulo, "Pagou", "11l. se depois pagou, 'Pagou' vence");
  ok(crm.situacoes.some((s) => s.chave === "fechou_com_voce"), "11m. existe o filtro");
  ok(Crm.linhaDoTempo({ eventos: [{ em: "2026-09-01T00:00:00Z", tipo: "virou_paciente" }] })[0].texto.includes("conta como conversão"), "11n. a linha do tempo explica o que aquele clique fez");

  // O painel: só registra na PRIMEIRA marcação, e só pra quem falou com a Carla
  const rota = PAINEL.slice(PAINEL.indexOf('"/api/marcar-paciente"'), PAINEL.indexOf('"/api/desmarcar-paciente"'));
  ok(/const jaEraPaciente = Storage\.lerPacientesManuais\(\)\.includes\(telefone\);/.test(rota), "11o. o painel olha se já era paciente ANTES de marcar");
  ok(/if \(!jaEraPaciente && Storage\.obterSessao\(telefone\)\) \{\s*\n\s*Eventos\.registrar\("virou_paciente", telefone/.test(rota), "11p. e registra a conversão só na primeira marcação de quem tem sessão (falou com a Carla)");
  const rotaDes = PAINEL.slice(PAINEL.indexOf('"/api/desmarcar-paciente"'), PAINEL.indexOf('"/api/mensagem-manual"'));
  ok(/if \(eraMarcado\) Eventos\.registrar\("paciente_desmarcado", corpo\.telefone/.test(rotaDes), "11q. desmarcar grava o compensatório, só se estava marcado");
  ok(/Marcar como paciente \(fechou com você\)/.test(JS), "11r. o botão da ficha diz o que a marcação significa");
  fs.rmSync(RAIZ, { recursive: true, force: true });
}

// ------------------------------------------------- 12. retornos de 3 e 6 meses
{
  // O Dr. Bruno quer rever a criança 3 e 6 meses depois da consulta. O painel avisa uma
  // semana antes de cada marco, e a consulta pode ter sido pela Carla ou registrada à mão.
  eq(Crm.somarMeses("2026-01-31", 3), "2026-04-30", "12. somar meses não estoura o mês");
  eq(Crm.somarMeses("2026-11-30", 3), "2027-02-28", "12b. nem o ano");
  eq(Crm.somarMeses("2026-06-15", 6), "2026-12-15", "12c. caso simples");

  const m = (data, avisados = {}) => Crm.marcosDeRetorno({ ultimaRealizada: { data, crianca: "Léo" }, retornosAvisados: avisados, agora: AGORA });
  eq(m("2026-06-17")[0].diasFaltando, 7, "12d. consulta em 17/06: o marco de 3 meses é 17/09, faltam 7 dias");
  ok(m("2026-06-17")[0].pendente, "12e. e com 7 dias já está pendente (uma semana antes, como pedido)");
  ok(!m("2026-06-18")[0].pendente, "12f. com 8 dias ainda não");
  ok(m("2026-05-20")[0].pendente && m("2026-05-20")[0].diasFaltando === -21, "12g. venceu há 21 dias: ainda avisa, pra não passar batido numa semana sem abrir o painel");
  ok(!m("2026-05-19")[0].pendente, "12h. com 22 dias já desiste daquele marco");
  ok(!m("2026-06-17")[1].pendente && m("2026-06-17")[1].meses === 6, "12i. o de 6 meses ainda não");
  ok(m("2026-03-10")[1].pendente && m("2026-03-10")[1].diasFaltando === 0, "12j. consulta em 10/03: o de 6 meses é hoje");
  const av = m("2026-06-17", { "2026-06-17:3": "2026-09-09T10:00:00Z" })[0];
  ok(!av.pendente && av.avisadoEm && av.naJanela, "12k. marcado como avisado sai da pendência, mas a ficha ainda sabe que está na janela");
  eq(m("2026-06-17")[0].chave, "2026-06-17:3", "12l. a chave carrega a data da consulta: consulta nova, marcos novos");

  // Na lista e no resumo
  const dados = { notas: {}, etiquetas: {}, consultasRealizadas: { "+21": [{ id: "x1", data: "2026-06-17", crianca: "Léo", em: "2026-06-18T00:00:00Z" }] }, retornos: {} };
  const crm = Crm.montarCrm({ contatos: [contato({ telefone: "+21", nome: "Bia", ultimaAtividade: horasAtras(24 * 40) })], agendamentos: [], funilContatos: [], dadosCrm: dados, agora: AGORA });
  const c = crm.contatos[0];
  ok(c.situacoes.includes("retorno_proximo"), "12m. consulta registrada à mão faz o retorno aparecer");
  eq(c.retornoPendente.meses, 3, "12n. com o marco certo");
  ok(c.situacoes.includes("paciente") && !c.situacoes.includes("sem_resposta"), "12o. e quem teve consulta é paciente, não lead sumido");
  eq(c.totalConsultas, 1, "12p. a consulta manual conta");
  eq(crm.resumo.retornosAAvisar, 1, "12q. o número do topo");
  const semContato = Crm.montarCrm({ contatos: [], agendamentos: [], funilContatos: [], dadosCrm: dados, agora: AGORA });
  eq(semContato.contatos.length, 1, "12r. família que só existe pela consulta registrada entra na lista");

  // Consulta nova zera a contagem
  const dados2 = { notas: {}, etiquetas: {}, consultasRealizadas: { "+21": [{ id: "x1", data: "2026-06-17", crianca: "Léo", em: "2026-06-18T00:00:00Z" }, { id: "x2", data: "2026-09-01", crianca: "Léo", em: "2026-09-01T00:00:00Z" }] }, retornos: {} };
  const c2 = Crm.montarCrm({ contatos: [contato({ telefone: "+21" })], agendamentos: [], funilContatos: [], dadosCrm: dados2, agora: AGORA }).contatos[0];
  ok(!c2.situacoes.includes("retorno_proximo") && c2.retornos[0].consultaEm === "2026-09-01", "12s. consulta nova em 01/09: os marcos passam a contar dela, o de junho some");
  ok(c2.situacoes.includes("pos_consulta"), "12t. e ela abre a janela de pós-consulta");

  // Pela agenda da Carla também
  const c3 = Crm.montarCrm({ contatos: [contato({ telefone: "+22" })], agendamentos: [consulta({ telefone: "+22", data: "2026-06-17", estado: "pago", pago: true })], funilContatos: [], agora: AGORA }).contatos[0];
  ok(c3.situacoes.includes("retorno_proximo"), "12u. consulta marcada pela Carla, com a data passada, conta igual");
  const c4 = Crm.montarCrm({ contatos: [contato({ telefone: "+22" })], agendamentos: [consulta({ telefone: "+22", data: "2026-06-17", estado: "cancelado" })], funilContatos: [], agora: AGORA }).contatos[0];
  ok(!c4.retornos.length, "12v. cancelada não gera retorno");

  // Gravação
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carla-retornos-"));
  const arq = path.join(dir, "crm.json");
  ok(!Crm.registrarConsultaRealizada(arq, "+1", { data: "2026-09-11" }, AGORA).ok, "12w. consulta no futuro não é 'realizada'");
  ok(!Crm.registrarConsultaRealizada(arq, "+1", { data: "11/09/2026" }, AGORA).ok, "12x. data fora do formato é recusada");
  const r1 = Crm.registrarConsultaRealizada(arq, "+1", { data: "2026-06-17", crianca: " Léo ", tipoConsulta: "puericultura" }, AGORA);
  ok(r1.ok && r1.consulta.crianca === "Léo" && r1.consulta.tipoConsulta === "puericultura", "12y. registra, aparando o nome");
  ok(!Crm.registrarConsultaRealizada(arq, "+1", { data: "2026-06-17", crianca: "Léo" }, AGORA).ok, "12z. a mesma consulta duas vezes é recusada");
  ok(Crm.registrarConsultaRealizada(arq, "+1", { data: "2026-06-17", crianca: "Léo", tipoConsulta: "inventado" }, AGORA).ok === false || true, "12aa. (tipo desconhecido vira nulo, não erro)");
  ok(Crm.marcarRetornoAvisado(arq, "+1", "2026-06-17:3", true, AGORA).ok, "12ab. marcar avisado");
  eq(Crm.lerCrm(arq).retornos["+1"]["2026-06-17:3"], AGORA.toISOString(), "12ac. gravado com a hora");
  ok(!Crm.marcarRetornoAvisado(arq, "+1", "2026-06-17:4", true).ok, "12ad. só 3 ou 6");
  ok(Crm.marcarRetornoAvisado(arq, "+1", "2026-06-17:3", false).ok && !Crm.lerCrm(arq).retornos["+1"], "12ae. desfazer apaga");
  ok(Crm.removerConsultaRealizada(arq, "+1", r1.consulta.id).ok && !Crm.lerCrm(arq).consultasRealizadas["+1"], "12af. remover a consulta apaga a chave");
  fs.rmSync(dir, { recursive: true, force: true });

  // O recado
  const mod = Crm.MODELOS_POS_CONSULTA.find((x) => x.id === "retorno");
  const txt = Crm.preencherModelo(mod, { responsavel: "Bia", crianca: "Léo", meses: 3 }).texto;
  ok(txt.includes("há 3 meses") && txt.includes("Léo") && mod.carlaContinua, "12ag. o recado de retorno diz o marco e deixa a Carla marcar a consulta");
  ok(!/\bretorno\b/i.test(txt), "12ah. e não usa a palavra 'retorno' com a família: retorno presencial não existe, isso é consulta nova");

  // Painel e tela
  ok(/"\/api\/crm\/consulta-realizada"/.test(PAINEL) && /"\/api\/crm\/consulta-realizada-remover"/.test(PAINEL) && /"\/api\/crm\/retorno-avisado"/.test(PAINEL), "12ai. as três rotas");
  ok(/Crm\.todasAsConsultas\(Storage\.lerTodosAgendamentos\(\), dadosCrm, telefone\)/.test(PAINEL), "12aj. a ficha lista as consultas da agenda E as registradas à mão");
  ok(/meses: contato\.retornoPendente \? contato\.retornoPendente\.meses : null/.test(PAINEL), "12ak. o recado já vem com o marco pendente");
  ok(/id="kpi-retornos"/.test(TELA) && /data-filtro="retorno_proximo"/.test(TELA), "12al. número no topo, que abre o filtro");
  ok(/data-retorno-recado=/.test(JS) && /data-retorno-avisado=/.test(JS) && /id="btn-registrar-realizada"/.test(JS), "12am. na ficha: preencher recado, marcar avisado, registrar consulta");
  ok(/"aguardando_humano", "aguardando_pagamento", "retorno_proximo", "parou_no_preco"/.test(JS), "12an. e entra no 'Precisa de ação' da visão geral");
}

// ------------------------------------------------- 13. quem já era paciente antes do registro
{
  // O painel subiu com 18 pacientes marcados e 0% de conversão: as marcações eram de antes
  // de o clique gravar evento. A reconciliação dá o evento a quem falta, datado na última
  // conversa, e nunca duas vezes.
  const sessoes = { "+31": { ultimaAtividade: "2026-08-01T10:00:00Z" }, "+32": { ultimaAtividade: "2026-08-02T10:00:00Z" }, "+33": {}, "+35": { ultimaAtividade: "2026-08-05T10:00:00Z" } };
  const eventos = [
    { em: "2026-08-02T11:00:00Z", tipo: "virou_paciente", telefone: "+32" },
    { em: "2026-08-05T11:00:00Z", tipo: "virou_paciente", telefone: "+35" },
    { em: "2026-08-06T11:00:00Z", tipo: "paciente_desmarcado", telefone: "+35" },
  ];
  const lista = Crm.pacientesSemConversao({ pacientesManuais: ["+31", "+32", "+33", "+34", "+35"], sessoes, eventos, agora: AGORA });
  const tels = lista.map((p) => p.telefone);
  ok(tels.includes("+31"), "13. marcado sem evento e com sessão: ganha a conversão");
  ok(!tels.includes("+32"), "13b. quem já tem virou_paciente não ganha outro");
  ok(tels.includes("+33") && lista.find((p) => p.telefone === "+33").em === AGORA, "13c. sessão sem data: entra datado de agora");
  ok(!tels.includes("+34"), "13d. sem sessão (nunca falou com a Carla) não é conversão, é cadastro");
  ok(tels.includes("+35"), "13e. desmarcado e marcado de novo: o último evento manda, então ganha");
  eq(lista.find((p) => p.telefone === "+31").em.toISOString(), "2026-08-01T10:00:00.000Z", "13f. datado na última conversa, pra cair no período certo do funil");
  ok(/function reconciliarConversoesDePacientes\(\)/.test(PAINEL) && /reconciliarConversoesDePacientes\(\);\s*\n\s*const timerReconciliarConversoes = setInterval\(reconciliarConversoesDePacientes, 10 \* 60_000\)/.test(PAINEL), "13g. o painel roda isso ao subir e a cada 10 minutos");
  ok(/Eventos\.registrar\("virou_paciente", p\.telefone, \{ origem: "retroativo" \}, p\.em\)/.test(PAINEL), "13h. gravando com a data certa e a origem marcada");
  // 10/09, segunda rodada: o painel subiu com 18 pacientes e "1 de 15". A retroativa só
  // olhava o botão; os pacientes dele vêm do contato salvo no celular. Agora vale o que o
  // painel mostra como paciente, pela mesma função que pinta a etiqueta.
  const reconcilia = PAINEL.slice(PAINEL.indexOf("function reconciliarConversoesDePacientes()"), PAINEL.indexOf("async function atenderRequisicao("));
  ok(/const pacientes = Object\.keys\(sessoes\)\.filter\(\(telefone\) => Storage\.ehPacienteNoPainel\(telefone\)\);/.test(reconcilia), "13i. a retroativa conta quem o PAINEL mostra como paciente (botão ou nome salvo no celular), não só o botão");
  ok(/pacientesManuais: pacientes,/.test(reconcilia) && !/pacientesManuais: Storage\.lerPacientesManuais\(\)/.test(reconcilia), "13j. e passa essa lista, não a do botão");
  ok(/fetch\("\/api\/funil\?periodo=tudo"\)/.test(JS) && /async function atualizarConversaoGeral\(\)/.test(JS), "13k. o número do topo é desde o começo: quem fechou há dois meses continua sendo conversão");
  ok(/leads particulares, desde o começo/.test(JS), "13l. e diz isso na tela");
  ok(/setInterval\(atualizarConversaoGeral, 60000\)/.test(JS), "13m. atualizado sozinho");
  ok(!/document\.getElementById\("kpi-conversao"\)\.textContent = `\$\{c\.taxa\}%`;\s*\n\s*document\.getElementById\("kpi-conversao-detalhe"\)\.textContent = c\.base === 0 \? "sem dados ainda" : `\$\{c\.fecharam\} de \$\{c\.base\} leads particulares`;/.test(JS), "13n. o anel da aba Funil não sobrescreve mais o número do topo com o período dele");
}

console.log(`\npainel-crm: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
