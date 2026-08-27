"use strict";

// Registro do funil: o que acontece entre "chamou no WhatsApp" e "compareceu na consulta".
//
// POR QUE ISSO EXISTE. O sistema guardava só ESTADO ATUAL, nunca história. O histórico da
// conversa é descartado depois de 4 horas de silêncio e a sessão mantém só a última
// mensagem. Então não havia como responder a pergunta que decide o negócio: "quantas
// famílias perguntaram o valor este mês e sumiram, e em que ponto elas sumiram?". Esse dado
// passava e evaporava, todo dia.
//
// A alternativa que apareceu foi uma planilha preenchida à mão por uma secretária. Não faz
// sentido: a Carla leu cada mensagem, ela já sabe de tudo isso. O que faltava era gravar.
//
// FORMATO: JSONL, uma linha por evento, SÓ APPEND, nunca reescrito. Escolhido de propósito:
//   - append de linha curta é atômico o suficiente no POSIX, então dois processos (bot e
//     painel) escrevendo juntos não corrompem o arquivo nem perdem linha;
//   - não precisa de escrita atômica com arquivo temporário, porque nada é reescrito;
//   - linha corrompida (queda no meio da escrita) custa UMA linha, não o arquivo inteiro;
//   - vira CSV pro Dr. Bruno com uma passada.
//
// NUNCA DERRUBA NADA. Toda gravação é envolvida em try/catch e falha em silêncio no log.
// Registrar o funil é secundário: se falhar, a família não pode nem perceber.
//
// O QUE NÃO GUARDA: conversa inteira. Só um trecho de 140 caracteres da mensagem, que é o
// mesmo limite que a sessão já usa. Serve pra conferir se a classificação acertou, não pra
// reler o atendimento.

const fs = require("fs");
const path = require("path");

const DIR_DADOS = path.join(__dirname, "data");
const ARQ_EVENTOS = path.join(DIR_DADOS, "eventos.jsonl");

const LIMITE_TRECHO = 140;

// ---------------------------------------------------------------- classificação

// Operadoras que aparecem de verdade na região, mais as palavras genéricas. Quem chega
// perguntando isso NÃO é lead particular: é gente procurando atendimento pelo plano. Somar
// os dois no mesmo balde é o que faz parecer que "95% fogem do preço" quando na verdade
// dois terços nunca foram público. Separar isso é o motivo principal deste arquivo existir.
const CONVENIO = [
  "unimed", "bradesco", "amil", "sulamerica", "sul america", "hapvida", "notredame",
  "notre dame", "porto seguro", "care plus", "omint", "golden cross", "prevent senior",
  "são francisco", "sao francisco", "santa casa", "cassi", "geap", "ipasp",
  "convenio", "convênio", "plano de saude", "plano de saúde", "meu plano", "pelo plano",
  "aceita plano", "atende plano", "cobertura", "reembolso",
];

const PRECO = [
  "quanto custa", "quanto e a consulta", "quanto é a consulta", "quanto fica",
  "qual o valor", "qual valor", "o valor da consulta", "valor da consulta",
  "preco", "preço", "quanto sai", "quanto voce cobra", "quanto você cobra", "honorario",
];

const AGENDAR = [
  "agendar", "marcar", "marcacao", "marcação", "quero uma consulta", "queria uma consulta",
  "gostaria de uma consulta", "tem horario", "tem horário", "disponibilidade", "agenda",
];

const SINTOMA = [
  "febre", "tosse", "dor", "vomit", "vômit", "diarreia", "diarréia", "alergia", "mancha",
  "coceira", "chiado", "falta de ar", "peso", "engasg", "choro", "chora muito", "nao come",
  "não come", "nao dorme", "não dorme", "refluxo", "assadura", "cocô", "coco liquido",
  "autismo", "tea", "atraso", "nao fala", "não fala", "birra", "convulsao", "convulsão",
  "gripe", "resfriado", "garganta", "ouvido", "barriga", "intestino", "vacina",
];

function semAcento(texto) {
  return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function contem(alvo, lista) {
  return lista.some((termo) => alvo.includes(semAcento(termo)));
}

// A ORDEM IMPORTA e não é arbitrária:
//   convênio primeiro, porque "quanto custa pelo convênio" é lead de convênio, não de preço;
//   preço antes de agendar, porque "queria marcar, quanto custa?" a decisão é o preço;
//   sintoma antes de agendar pelo mesmo motivo: quem diz o caso já disse o que importa.
// "outro" é quase sempre saudação ("bom dia", "tudo bem?"), que é a maioria das primeiras
// mensagens de verdade. Por isso o funil procura a primeira mensagem que NÃO é "outro".
function classificar(texto) {
  const t = semAcento(texto);
  if (!t.trim()) return "outro";
  if (contem(t, CONVENIO)) return "convenio";
  if (contem(t, PRECO)) return "preco";
  if (contem(t, SINTOMA)) return "sintoma";
  if (contem(t, AGENDAR)) return "agendar";
  return "outro";
}

// ---------------------------------------------------------------- gravação

function garantirPasta() {
  if (!fs.existsSync(DIR_DADOS)) fs.mkdirSync(DIR_DADOS, { recursive: true });
}

// Fire-and-forget de propósito: o funil é observação, nunca pode atrasar nem derrubar a
// resposta pra família. Devolve true/false só pra bateria de teste conseguir verificar.
function registrar(tipo, telefone, dados = {}, agora = new Date()) {
  if (!tipo) return false;
  try {
    garantirPasta();
    const linha = JSON.stringify({
      em: agora.toISOString(),
      tipo,
      telefone: telefone || null,
      ...dados,
    });
    fs.appendFileSync(ARQ_EVENTOS, linha + "\n", { encoding: "utf8", mode: 0o600, flag: "a" });
    try { fs.chmodSync(ARQ_EVENTOS, 0o600); } catch (erroPermissao) {
      if (process.platform !== "win32") throw erroPermissao;
    }
    return true;
  } catch (erro) {
    console.error("[EVENTOS] Não consegui registrar:", erro.message);
    return false;
  }
}

function trecho(texto) {
  return String(texto || "").slice(0, LIMITE_TRECHO);
}

// ---------------------------------------------------------------- leitura

// Linha corrompida é PULADA, não derruba a leitura: o arquivo cresce para sempre e uma
// queda no meio de um append não pode inutilizar meses de histórico.
function lerEventos({ desde = null, ate = null } = {}) {
  let bruto;
  try {
    bruto = fs.readFileSync(ARQ_EVENTOS, "utf8");
  } catch {
    return [];
  }
  const eventos = [];
  for (const linha of bruto.split("\n")) {
    if (!linha.trim()) continue;
    let e;
    try { e = JSON.parse(linha); } catch { continue; }
    if (!e || !e.tipo || !e.em) continue;
    if (desde && e.em < desde) continue;
    if (ate && e.em > ate) continue;
    eventos.push(e);
  }
  return eventos;
}

// ---------------------------------------------------------------- o funil

// "Perguntou o valor" NÃO é etapa, é SEGMENTO, e está em porPergunta. Nem todo mundo que
// soube o preço perguntou por ele: a Carla informa por conta própria antes de confirmar
// qualquer reserva. Como etapa, ela ficava MENOR que a etapa seguinte e o funil alargava no
// meio, que é impossível de ler. A bateria tem uma trava pra isso não voltar.
//
// As etapas, na ordem em que a família passa por elas. Cada telefone conta UMA vez por
// etapa, e conta em todas as etapas que alcançou — quem agendou também consta em "recebeu
// horário", senão o funil não afunila e a leitura fica errada.
const ETAPAS = [
  { chave: "contatos", rotulo: "Chamaram no WhatsApp" },
  { chave: "recebeuPreco", rotulo: "Souberam o valor" },
  { chave: "recebeuHorario", rotulo: "Receberam horário" },
  { chave: "agendou", rotulo: "Agendaram" },
  { chave: "pagou", rotulo: "Pagaram" },
];

// Monta o funil a partir dos eventos crus. Trabalha por TELEFONE, não por evento: uma
// família que mandou quinze mensagens é um contato, não quinze.
//
// O recorte é de ATIVIDADE: entram famílias que tiveram algum evento dentro do período; o
// estágio delas é reconstruído com o histórico até o fim do recorte. Isso é necessário para
// não chamar de "não pago" alguém que pagou antes do primeiro dia selecionado e voltou a
// conversar agora. Não é uma coorte fixa de quem começou no período. A API e a tela expõem
// essa semântica para o número não parecer outra coisa.
function funil({ desde = null, ate = null } = {}) {
  const atividade = lerEventos({ desde, ate });
  const telefonesAtivos = new Set(atividade.filter((e) => e.telefone).map((e) => e.telefone));
  // Sem filtro, já temos o histórico inteiro. Com filtro, buscamos também o que veio antes
  // apenas para os telefones ativos no recorte; eventos posteriores a `ate` nunca vazam.
  const eventos = (desde || ate)
    ? lerEventos({ ate }).filter((e) => e.telefone && telefonesAtivos.has(e.telefone))
    : atividade;
  const porTelefone = new Map();
  const pagamentosAbertos = new Map();

  function doTelefone(tel) {
    if (!porTelefone.has(tel)) {
      porTelefone.set(tel, {
        telefone: tel, primeiraPergunta: null, primeiroContatoEm: null, ultimoEm: null,
        perguntouPreco: false, recebeuPreco: false, recebeuHorario: false,
        agendou: false, pagou: false, escalou: false,
      });
    }
    return porTelefone.get(tel);
  }

  for (const e of eventos) {
    if (!e.telefone) continue;
    const c = doTelefone(e.telefone);
    if (!c.primeiroContatoEm || e.em < c.primeiroContatoEm) c.primeiroContatoEm = e.em;
    if (!c.ultimoEm || e.em > c.ultimoEm) c.ultimoEm = e.em;

    if (e.tipo === "mensagem") {
      // A primeira pergunta DE VERDADE, não a primeira mensagem: quase toda conversa abre
      // com "bom dia", que não diz nada sobre o que a pessoa veio buscar.
      if (!c.primeiraPergunta && e.classe && e.classe !== "outro") c.primeiraPergunta = e.classe;
      if (e.classe === "preco") c.perguntouPreco = true;
      if (e.classe === "convenio" && !c.primeiraPergunta) c.primeiraPergunta = "convenio";
    }
    if (e.tipo === "preco_informado") c.recebeuPreco = true;
    if (e.tipo === "horarios_oferecidos") c.recebeuHorario = true;
    if (e.tipo === "agendou") c.agendou = true;
    if (e.tipo === "pagou") {
      if (!pagamentosAbertos.has(e.telefone)) pagamentosAbertos.set(e.telefone, new Set());
      pagamentosAbertos.get(e.telefone).add(e.slotId || "__legado_sem_slot__");
    }
    if (e.tipo === "pagamento_desmarcado") {
      const abertos = pagamentosAbertos.get(e.telefone);
      if (abertos) {
        if (e.slotId) abertos.delete(e.slotId);
        else abertos.clear();
      }
      // Para desmarcar pagamento a consulta necessariamente já foi agendada. Preservar
      // essa etapa evita que o evento compensatório crie um contato solto no topo.
      c.agendou = true;
    }
    if (e.tipo === "escalou") c.escalou = true;
  }

  const contatos = [...porTelefone.values()];

  // Pagamento é estado, não apenas ocorrência histórica. Um mesmo telefone pode ter dois
  // filhos: desmarcar o pagamento de um slot não apaga o pagamento válido do outro.
  for (const c of contatos) {
    c.pagou = (pagamentosAbertos.get(c.telefone)?.size || 0) > 0;
  }

  // Quem agendou obviamente recebeu horário, e quem recebeu horário soube o valor (a regra
  // NUNCA CONFIRME SEM TER INFORMADO O VALOR garante isso). Sem essa normalização um evento
  // perdido faz o funil "alargar" no meio, o que confunde mais do que informa.
  for (const c of contatos) {
    if (c.pagou) c.agendou = true;
    if (c.agendou) c.recebeuHorario = true;
    if (c.recebeuHorario) c.recebeuPreco = true;
  }

  const etapas = ETAPAS.map(({ chave, rotulo }) => ({
    chave, rotulo,
    quantidade: chave === "contatos" ? contatos.length : contatos.filter((c) => c[chave]).length,
  }));

  // A maior queda entre duas etapas seguidas. É a resposta curta pra "onde está o gargalo".
  let maiorQueda = null;
  for (let i = 1; i < etapas.length; i++) {
    const perdeu = etapas[i - 1].quantidade - etapas[i].quantidade;
    if (perdeu > 0 && (!maiorQueda || perdeu > maiorQueda.perdeu)) {
      maiorQueda = { de: etapas[i - 1].rotulo, para: etapas[i].rotulo, perdeu };
    }
  }

  // O recorte que muda a leitura do negócio: quem chegou perguntando de convênio nunca foi
  // lead particular. Contar os dois juntos infla o total e faz a conversão parecer pior.
  const porPergunta = {};
  for (const c of contatos) {
    const k = c.primeiraPergunta || "outro";
    if (!porPergunta[k]) porPergunta[k] = { total: 0, agendou: 0 };
    porPergunta[k].total++;
    if (c.agendou) porPergunta[k].agendou++;
  }

  const particulares = contatos.filter((c) => c.primeiraPergunta !== "convenio");
  const fecharam = particulares.filter((c) => c.agendou).length;

  return {
    semantica: {
      chave: "atividade_no_periodo",
      rotulo: "Atividade no período",
      explicacao: "Famílias com algum evento no período; o estágio acumulado delas é reconstruído até o fim do recorte.",
    },
    etapas,
    maiorQueda,
    porPergunta,
    // Conversão sobre quem podia mesmo virar paciente, que é o número honesto.
    conversaoParticular: {
      base: particulares.length,
      fecharam,
      taxa: particulares.length === 0 ? 0 : Math.round((fecharam / particulares.length) * 100),
    },
    contatos,
  };
}

// ---------------------------------------------------------------- períodos

// Traduz o nome do período no corte de data. Mora aqui, e não no painel, pra ter teste:
// "mês" e "30 dias" não são a mesma coisa e a diferença aparece justamente no começo do
// mês, quando o funil do mês fica quase vazio e o de 30 dias ainda mostra a semana passada.
function periodoPara(nome, agora = new Date()) {
  if (nome === "tudo") return { desde: null, ate: null, rotulo: "Desde o começo" };
  if (nome === "mes") {
    const inicio = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
    return { desde: inicio.toISOString(), ate: null, rotulo: "Este mês" };
  }
  const dias = nome === "7d" ? 7 : 30;
  const inicio = new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000);
  return { desde: inicio.toISOString(), ate: null, rotulo: `Últimos ${dias} dias` };
}

// CSV do funil, uma linha por contato. É o que substitui a planilha que alguém preencheria
// à mão: sai pronta, com a primeira pergunta já classificada.
function csv({ desde = null, ate = null } = {}) {
  const { contatos } = funil({ desde, ate });
  const cab = ["telefone", "primeira_pergunta", "primeiro_contato", "ultimo_evento",
    "soube_valor", "recebeu_horario", "agendou", "pagou", "escalou"];
  const linhas = [cab.join(",")];
  const sn = (v) => (v ? "sim" : "nao");
  for (const c of contatos.sort((a, b) => String(a.primeiroContatoEm).localeCompare(b.primeiroContatoEm))) {
    linhas.push([
      c.telefone, c.primeiraPergunta || "outro", c.primeiroContatoEm || "", c.ultimoEm || "",
      sn(c.recebeuPreco), sn(c.recebeuHorario), sn(c.agendou), sn(c.pagou), sn(c.escalou),
    ].join(","));
  }
  return linhas.join("\n");
}

module.exports = {
  ARQ_EVENTOS,
  ETAPAS,
  classificar,
  registrar,
  trecho,
  lerEventos,
  funil,
  periodoPara,
  csv,
};
