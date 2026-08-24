/*
 * Bateria do reaquecimento de lead.
 *
 * A família falou, não fechou, sumiu. O Dr. Bruno aperta um botão e a Carla volta a falar
 * com ela UMA vez. Se a família responder, a conversa segue sozinha.
 *
 * O PERIGO DESTA FUNÇÃO. A Carla roda em Baileys, cliente NÃO OFICIAL do WhatsApp. Mensagem
 * não solicitada em massa é o padrão clássico de banimento, e o número banido é o do
 * consultório: perde a sessão, perde o contato com todos os pacientes, perde a Carla. Por
 * isso não existe disparo em lote, existe um botão por vez, e existem travas duras.
 *
 * O PROBLEMA DAS 4 HORAS, que quase passou batido. O histórico é apagado quando a família
 * volta a escrever depois de 4h (server.js, historicoExpirou). O detalhe é o MOMENTO: a
 * limpeza roda na CHEGADA da mensagem. Então a conversa de três dias atrás de quem nunca
 * mais escreveu ainda está inteira no sessoes.json, e seria apagada exatamente quando a
 * família respondesse ao reaquecimento — a Carla ficaria sem memória no pior instante.
 *
 * A saída não foi aumentar o prazo (isso traz de volta o defeito que a regra conserta: ela
 * retomando "Pix ou cartão?" de outro assunto). O botão converte o passado em FATOS, uma
 * vez, e manda pelo prompt do sistema. Ela sabe O QUE aconteceu sem ter os TURNOS.
 *
 * Roda com:  node tests/reaquecer-lead.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0, falhou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } falhou++; erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const RAIZ = path.join(__dirname, "..");
const Reaquecimento = require(path.join(RAIZ, "reaquecimento.js"));
const SERVER = fs.readFileSync(path.join(RAIZ, "server.js"), "utf8");
const PAINEL = fs.readFileSync(path.join(RAIZ, "painel-server.js"), "utf8");
const TELA = fs.readFileSync(path.join(RAIZ, "dashboard.html"), "utf8");
const CEREBRO = fs.readFileSync(path.join(RAIZ, "cerebro-ia.js"), "utf8");

const AGORA = new Date("2026-08-20T12:00:00Z");
const HA_TRES_DIAS = new Date("2026-08-17T12:00:00Z").toISOString();
const HA_DUAS_HORAS = new Date("2026-08-20T10:00:00Z").toISOString();
const OK = { respondeuAlgumaVez: true, ultimaAtividade: HA_TRES_DIAS };

// ------------------------------------------------- 1. o caminho feliz
{
  const v = Reaquecimento.podeReaquecer(OK, AGORA);
  ok(v.pode, "1. lead que respondeu e sumiu há 3 dias pode ser reaquecido");
  eq(v.motivo, null, "1b. e sem motivo de recusa");
}

// ------------------------------------------------- 2. a regra de ouro
{
  // Quem nunca respondeu não é lead esfriado: é número errado, engano ou desinteresse
  // total. É exatamente ali que mora a denúncia que derruba o número.
  const v = Reaquecimento.podeReaquecer({ ...OK, respondeuAlgumaVez: false }, AGORA);
  ok(!v.pode, "2. quem NUNCA respondeu não pode ser reaquecido");
  ok(/nunca respondeu/.test(v.motivo), "2b. e o motivo diz isso pro Dr. Bruno");
  ok(/bloqueado/.test(v.motivo), "2c. explicando o risco, senão parece burocracia e alguém tira a trava");
}

// ------------------------------------------------- 3. as outras travas
{
  const casos = [
    [{ silenciado: true }, /silenciado/i, "3. número silenciado"],
    [{ aguardandoHumano: true }, /esperando você/i, "3b. conversa em atendimento humano"],
    [{ temConsultaFutura: true }, /consulta marcada/i, "3c. quem já tem consulta"],
    [{ jaReaquecidoEm: HA_TRES_DIAS }, /Já foi reaquecido/, "3d. quem já foi reaquecido"],
    [{ ultimaAtividade: null }, /Sem registro/, "3e. sem conversa nenhuma"],
    [{ ultimaAtividade: HA_DUAS_HORAS }, /é de hoje/, "3f. conversa ainda quente"],
  ];
  for (const [extra, regex, nome] of casos) {
    const v = Reaquecimento.podeReaquecer({ ...OK, ...extra }, AGORA);
    ok(!v.pode, `${nome} é recusado`);
    ok(regex.test(v.motivo || ""), `${nome}: o motivo explica (veio "${v.motivo}")`);
  }
}

// ------------------------------------------------- 4. conversa de hoje não é lead frio
{
  // Reaquecer alguém que falou há duas horas é atropelar conversa viva, e é o jeito mais
  // rápido de irritar quem ainda estava decidindo.
  eq(Reaquecimento.ESFRIA_EM_MS, 24 * 60 * 60 * 1000, "4. o corte é de um dia");
  const quase = new Date(new Date(AGORA).getTime() - 23 * 60 * 60 * 1000).toISOString();
  ok(!Reaquecimento.podeReaquecer({ ...OK, ultimaAtividade: quase }, AGORA).pode,
    "4b. 23 horas ainda é cedo");
  const passou24 = new Date(new Date(AGORA).getTime() - 25 * 60 * 60 * 1000).toISOString();
  ok(Reaquecimento.podeReaquecer({ ...OK, ultimaAtividade: passou24 }, AGORA).pode,
    "4c. 25 horas já pode");
}

// ------------------------------------------------- 5. os fatos, não a conversa
{
  const fatos = Reaquecimento.montarContexto({
    ultimaAtividade: HA_TRES_DIAS, primeiraPergunta: "preco",
    recebeuPreco: true, recebeuHorario: true, crianca: "Felipe",
  }, AGORA);
  ok(/há 3 dias/.test(fatos), "5. diz quanto tempo faz");
  ok(/A criança é Felipe/.test(fatos), "5b. e o nome da criança quando o sistema sabe");
  ok(/perguntou o valor da consulta/.test(fatos), "5c. e por que ela chegou");
  ok(/Você já informou o valor/.test(fatos), "5d. e o que a Carla já disse");
  ok(/Você já ofereceu horário/.test(fatos), "5e. e o que já ofereceu");
  ok(/não respondeu depois disso e nenhuma consulta foi marcada/.test(fatos),
    "5f. e como aquilo terminou, que é a informação que decide o tom");

  // Sem o nome da criança o texto não pode ter buraco nem dizer "null".
  const magro = Reaquecimento.montarContexto({ ultimaAtividade: HA_TRES_DIAS }, AGORA);
  ok(!/null|undefined/.test(magro), "5g. sem dado, o texto não vaza null");
  ok(/há 3 dias/.test(magro), "5h. e continua dizendo o essencial");
}

// ------------------------------------------------- 6. ontem é "ontem"
{
  const ontem = new Date("2026-08-19T12:00:00Z").toISOString();
  ok(/falou com você ontem/.test(Reaquecimento.montarContexto({ ultimaAtividade: ontem }, AGORA)),
    "6. um dia vira 'ontem', não 'há 1 dias'");
}

// ------------------------------------------------- 7. a instrução protege a família
{
  const i = Reaquecimento.montarInstrucao();
  ok(/a família não pediu isso/.test(i), "7. deixa claro que quem puxou o assunto foi o consultório");
  ok(/UMA mensagem curta/.test(i), "7b. uma mensagem, não uma sequência");
  ok(/NÃO repita o valor/.test(i) && /NÃO liste horário/.test(i),
    "7c. sem despejar preço e horário em quem não pediu de volta");
  ok(/NÃO chame nenhuma ferramenta agora/.test(i),
    "7d. e sem consultar agenda: ela ainda não disse que quer seguir");
  ok(/deixando fácil dizer que não/.test(i), "7e. com saída fácil, que é o que evita denúncia");
  ok(/aceite na hora/.test(i), "7f. e recusa é aceita na hora");
  ok(/NÃO peça desculpa por sumir/.test(i),
    "7g. sem culpar a família por não ter respondido: quem parou foi a conversa");
}

// ------------------------------------------------- 8. o contexto vai pelo PROMPT, não pelo histórico
{
  // Se entrasse como turno, a Carla trataria os fatos como coisa que a família disse, e o
  // anti-spoof do canal cairia junto. É a mesma decisão do recado do Dr. Bruno.
  ok(/VOCÊ ESTÁ REABRINDO ESTA CONVERSA/.test(CEREBRO), "8. o bloco existe no prompt");
  ok(/NÃO são mensagens dela e você NÃO tem os turnos/.test(CEREBRO),
    "8b. dizendo que não são turnos, senão ela responde os fatos como se fossem fala da mãe");
  ok(/nunca como assunto pendente pra retomar do meio/.test(CEREBRO),
    "8c. e proibindo retomar do meio, que é o defeito que a limpeza das 4h conserta");
  ok(/historico: \[\],\s*\n?\s*now: agora/.test(SERVER.replace(/\s+/g, " ").replace(/historico: \[\], now: agora/, "historico: [],\n now: agora"))
    || /historico: \[\]/.test(SERVER),
    "8d. e a chamada manda histórico VAZIO: os turnos velhos não voltam");
}

// ------------------------------------------------- 9. o contexto não pode sujar o cache
{
  // O prompt é cacheado por prefixo: um byte diferente no bloco estável invalida tudo. O
  // reaquecimento muda de conversa pra conversa, então tem que morar no bloco volátil.
  const estavel = CEREBRO.slice(CEREBRO.indexOf("const PROMPT_ESTAVEL = `"),
    CEREBRO.indexOf("function montarContextoDoAtendimento("));
  ok(!/REABRINDO ESTA CONVERSA/.test(estavel),
    "9. o bloco de reaquecimento NÃO pode estar no prompt estável, senão quebra o cache");
  const contexto = CEREBRO.slice(CEREBRO.indexOf("function montarContextoDoAtendimento("),
    CEREBRO.indexOf("function montarSystemPrompt("));
  ok(/REABRINDO ESTA CONVERSA/.test(contexto), "9b. ele mora no bloco de contexto, que é o volátil");
}

// ------------------------------------------------- 10. marca ANTES de enviar
{
  // Duplo clique é o erro caro aqui: manda duas mensagens não solicitadas pra mesma pessoa.
  // Marcar depois do envio deixaria essa janela aberta.
  const bloco = SERVER.slice(SERVER.indexOf("async function reaquecerLead"),
                             SERVER.indexOf("async function processarMensagem"));
  const posMarca = bloco.indexOf("sessao.reaquecidoEm = agora.toISOString();");
  const posEnvio = bloco.indexOf("await enviarResposta(");
  ok(posMarca > 0 && posEnvio > posMarca,
    "10. a marca de 'já reaquecido' é gravada antes do envio");
  ok(/Marca ANTES de enviar/.test(bloco), "10b. e o porquê está escrito no código");
  ok(/Eventos\.registrar\("reaquecido"/.test(bloco), "10c. e o funil registra o reaquecimento");
}

// ------------------------------------------------- 11. não existe disparo em lote
{
  // A decisão mais importante do arquivo inteiro. Um botão por vez, com o dedo dele no
  // gatilho, é o que mantém isso longe do banimento enquanto ninguém sabe se funciona.
  ok(/NÃO existe versão em lote aqui, de propósito/.test(PAINEL),
    "11. a ausência de lote está documentada como decisão, não como esquecimento");
  ok(/cliente NÃO OFICIAL do\n?\s*\/\/ WhatsApp|cliente NÃO OFICIAL do/.test(PAINEL), "11b. com o motivo: o cliente não é oficial");
  ok(!/reaquecer-todos|reaquecerTodos|reaquecer-lote/.test(PAINEL + SERVER + TELA),
    "11c. e não existe rota nem botão de lote em lugar nenhum");
}

// ------------------------------------------------- 12. o painel só encaminha
{
  ok(/encaminharAoBot\("\/interno\/reaquecer"/.test(PAINEL),
    "12. o painel encaminha pro bot, que é quem tem a conexão do WhatsApp");
  ok(/req\.url === "\/interno\/reaquecer"/.test(SERVER), "12b. e o bot atende nessa rota");
}

// ------------------------------------------------- 13. a tela pede confirmação
{
  // Regex frouxo aqui deixa passar `if (false && !confirm(...))`, que é a confirmação
  // desligada sem sumir do código. A trava é a linha INTEIRA: confirmar ou sair.
  ok(/^\s*if \(!confirm\(`[^`]+`\)\) return;$/m.test(TELA),
    "13. o clique só segue se o confirm() disser sim, e nada pode vir antes dessa condição");
  ok(/só pode ser feito uma vez por contato/.test(TELA),
    "13b. e a confirmação avisa que é uma vez só");
  ok(/botao\.disabled = true/.test(TELA), "13c. o botão trava enquanto envia, contra duplo clique");
  ok(/function podeMostrarReaquecer/.test(TELA), "13d. e só aparece pra quem faz sentido");
  ok(/esconder botão não é segurança/.test(TELA),
    "13e. com o comentário dizendo que a trava de verdade está no servidor");
}

// ------------------------------------------------- 14. o que já funcionava não mudou
{
  ok(/RECADO DO DR\. BRUNO/.test(CEREBRO), "14. o recado do Dr. Bruno continua");
  ok(/historicoExpirou\(sessao, now\)/.test(SERVER), "14b. a limpeza das 4h continua de pé");
  ok(/req\.url === "\/interno\/resposta-do-doutor"/.test(SERVER), "14c. e a resposta pelo painel também");
}

console.log(`\nreaquecer-lead: ${passou} passaram, ${falhou} falharam`);
if (falhou) { erros.forEach((e) => console.log("  FALHOU: " + e)); process.exit(1); }
