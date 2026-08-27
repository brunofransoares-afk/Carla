// Persistência em disco (equivalente ao localStorage da versão de teste no navegador).
// Mesma responsabilidade do storage.js do carla-app: é a única peça que muda
// quando se troca onde os dados ficam guardados. A lógica da Carla nunca toca aqui direto.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const { escreverTextoAtomico, escreverJSONAtomico, lerJSONSeguro } = require("./arquivo-atomico.js");

// Garante CARLA_CONFIG (global) antes do Agenda, que depende dele — precisa disso aqui
// porque o painel (painel-server.js) usa este arquivo sem nunca ter carregado config.js.
require(path.join(__dirname, "carla-app", "js", "config.js"));
const Agenda = require(path.join(__dirname, "carla-app", "js", "agenda.js"));

const DIR_DADOS = path.join(__dirname, "data");
const ARQ_AGENDAMENTOS = path.join(DIR_DADOS, "agendamentos.json");
const ARQ_AGENDAMENTOS_CSV = path.join(DIR_DADOS, "agendamentos.csv");
const ARQ_AGENDAMENTOS_DB = path.join(DIR_DADOS, "agendamentos.sqlite");
const ARQ_ALERTAS = path.join(DIR_DADOS, "alertas.json");
const ARQ_SESSOES = path.join(DIR_DADOS, "sessoes.json");
const ARQ_BLOQUEIOS = path.join(DIR_DADOS, "bloqueios.json");
const ARQ_BLOQUEIOS_HORARIOS = path.join(DIR_DADOS, "bloqueios-horarios.json");
const ARQ_SILENCIADOS = path.join(DIR_DADOS, "contatos-silenciados.json");
const ARQ_CONTATOS_WHATSAPP = path.join(DIR_DADOS, "contatos-whatsapp.json");
const ARQ_PACIENTES_MANUAIS = path.join(DIR_DADOS, "pacientes-manuais.json");
const ARQ_NAO_PACIENTES_MANUAIS = path.join(DIR_DADOS, "nao-pacientes-manuais.json");
const ARQ_HORARIOS_EXTRAS = path.join(DIR_DADOS, "horarios-extras.json");
const ARQ_DADOS_PENDENTES = path.join(DIR_DADOS, "dados-pendentes.json");
const ARQ_MENSAGENS_PENDENTES = path.join(DIR_DADOS, "mensagens-pendentes.json");

function garantirPasta() {
  if (!fs.existsSync(DIR_DADOS)) fs.mkdirSync(DIR_DADOS, { recursive: true });
}

function lerJSON(caminho, padrao) {
  garantirPasta();
  return lerJSONSeguro(caminho, padrao);
}

function escreverJSON(caminho, dados) {
  garantirPasta();
  escreverJSONAtomico(caminho, dados);
}

// Bot e painel são processos separados. A troca atômica impede arquivo pela metade, mas
// sozinha não impede o clássico "os dois leram a versão A e o último apagou a mudança do
// primeiro". Toda atualização de um JSON compartilhado passa por este lock curto e relê o
// arquivo somente depois de obtê-lo.
function comLockArquivo(lock, trabalho, descricao = "arquivo") {
  const limite = Date.now() + 10000;
  while (true) {
    try {
      const fd = fs.openSync(lock, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`, "utf8");
        fs.fsyncSync(fd);
        return trabalho();
      } finally {
        try { fs.closeSync(fd); } catch {}
        try { fs.unlinkSync(lock); } catch {}
      }
    } catch (erro) {
      const disputaWindows = process.platform === "win32"
        && erro && ["EPERM", "EACCES"].includes(erro.code);
      if (!erro || (erro.code !== "EEXIST" && !disputaWindows)) throw erro;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.unlinkSync(lock);
      } catch (falha) {
        const transitorioWindows = process.platform === "win32"
          && falha && ["EPERM", "EACCES"].includes(falha.code);
        if (falha && falha.code !== "ENOENT" && !transitorioWindows) throw falha;
      }
      if (Date.now() >= limite) throw new Error(`Tempo esgotado aguardando lock de ${descricao}`);
      Atomics.wait(ESPERA_LOCK, 0, 0, 10);
    }
  }
}

function atualizarJSON(caminho, padrao, alterar) {
  garantirPasta();
  return comLockArquivo(`${caminho}.lock`, () => {
    const dados = lerJSON(caminho, padrao);
    const resultado = alterar(dados);
    escreverJSON(caminho, dados);
    return resultado;
  }, path.basename(caminho));
}

// -----------------------------------------------------------------------------
// Agenda transacional
//
// Bot e painel são dois processos diferentes. Escrita atômica evita JSON quebrado, mas
// não impede os dois de lerem a mesma versão e um apagar a mudança do outro. Por isso os
// agendamentos — a parte em que perder um campo significa pagamento/ficha/horário errado —
// passam a ter o SQLite como fonte de verdade. O JSON continua sendo exportado para leitura,
// backup e rollback humano, mas nunca é usado como fonte depois da migração inicial.
//
// node:sqlite faz parte do Node usado em produção (22+), então não acrescenta dependência.
const ESTADOS_AGENDAMENTO = new Set(["reservado", "pago", "vencido", "cancelado"]);
const ESTADOS_ATIVOS = new Set(["reservado", "pago"]);
const PAGAMENTO_IMEDIATO_MINUTOS = Math.max(1, Number(process.env.PAGAMENTO_IMEDIATO_TOLERANCIA_MIN) || 30);
let bancoAgendamentos = null;
const ESPERA_LOCK = new Int32Array(new SharedArrayBuffer(4));

function chaveHorarioReal(data, horario) {
  return `${String(data || "").trim()}T${String(horario || "").trim()}`;
}

function limiteDePagamento({ data, horario }, criadoEm = new Date()) {
  const [ano, mes, dia] = String(data || "").split("-").map(Number);
  const [hora = 0, minuto = 0] = String(horario || "00:00").split(":").map(Number);
  if (![ano, mes, dia, hora, minuto].every(Number.isFinite)) {
    return new Date(criadoEm.getTime() + PAGAMENTO_IMEDIATO_MINUTOS * 60000);
  }

  const limite = new Date(ano, mes - 1, dia);
  if (String(horario) >= "12:00") {
    limite.setHours(12, 0, 0, 0);
  } else {
    limite.setDate(limite.getDate() - 1);
    limite.setHours(23, 59, 59, 999);
  }

  // Reserva feita depois do prazo ainda precisa de uma janela curta para o Pix/cartão
  // "agora". Sem esta tolerância ela nasceria vencida no mesmo milissegundo.
  if (limite <= criadoEm) {
    return new Date(criadoEm.getTime() + PAGAMENTO_IMEDIATO_MINUTOS * 60000);
  }
  return limite;
}

function estadoLegado(item) {
  if (ESTADOS_AGENDAMENTO.has(item && item.estado)) return item.estado;
  if (item && item.canceladoEm) return "cancelado";
  if (item && item.vencidoEm) return "vencido";
  return item && item.pago ? "pago" : "reservado";
}

function normalizarAgendamento(item, now = new Date()) {
  const copia = { ...(item || {}) };
  // Antes desta separação, `slotId` identificava ao mesmo tempo a vaga da grade e a
  // consulta. Registros legados mantêm sua identidade e ganham explicitamente a vaga que
  // ocupavam. Reservas novas recebem um slotId próprio em reservar().
  if (!copia.agendaSlotId && copia.slotId) copia.agendaSlotId = copia.slotId;
  copia.estado = estadoLegado(copia);
  copia.pago = copia.estado === "pago";
  if (!copia.expiresAt && copia.expiraEm) copia.expiresAt = copia.expiraEm;
  if (copia.estado === "reservado" && !copia.expiresAt) {
    const criado = new Date(copia.registradoEm || now);
    const base = Number.isNaN(criado.getTime()) ? now : criado;
    copia.expiresAt = limiteDePagamento(copia, base).toISOString();
  }
  if (copia.estado !== "reservado") copia.expiresAt = null;
  return copia;
}

function materializarLinha(linha) {
  const item = JSON.parse(linha.payload_json);
  const slotLegado = item.slotId || linha.slot_id;
  item.slotId = linha.slot_id;
  if (!item.agendaSlotId) item.agendaSlotId = slotLegado;
  item.estado = linha.estado;
  item.expiresAt = linha.expires_at || null;
  item.pago = linha.estado === "pago";
  if (linha.estado === "vencido" && !item.vencidoEm) item.vencidoEm = linha.updated_at;
  if (linha.estado === "cancelado" && !item.canceladoEm) item.canceladoEm = linha.updated_at;
  return item;
}

function iniciarBancoAgendamentos() {
  if (bancoAgendamentos) return bancoAgendamentos;
  garantirPasta();
  const db = new DatabaseSync(ARQ_AGENDAMENTOS_DB);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA busy_timeout = 10000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS agenda_meta (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agendamentos (
      slot_id TEXT PRIMARY KEY,
      horario_real TEXT NOT NULL,
      estado TEXT NOT NULL CHECK (estado IN ('reservado','pago','vencido','cancelado')),
      expires_at TEXT,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS agendamentos_horario_ativo
      ON agendamentos(horario_real)
      WHERE estado IN ('reservado','pago');
    CREATE INDEX IF NOT EXISTS agendamentos_estado_expira
      ON agendamentos(estado, expires_at);
  `);
  bancoAgendamentos = db;
  migrarAgendamentosDoJSON(db);
  return db;
}

function emTransacao(db, trabalho) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const resultado = trabalho();
    db.exec("COMMIT");
    return resultado;
  } catch (erro) {
    try { db.exec("ROLLBACK"); } catch {}
    throw erro;
  }
}

function migrarAgendamentosDoJSON(db) {
  emTransacao(db, () => {
    const feita = db.prepare("SELECT valor FROM agenda_meta WHERE chave = ?").get("json_importado_v1");
    if (feita) return;

    const antigos = lerJSON(ARQ_AGENDAMENTOS, []);
    if (!Array.isArray(antigos)) throw new Error("agendamentos.json precisa conter uma lista");
    if (fs.existsSync(ARQ_AGENDAMENTOS)) {
      const copia = `${ARQ_AGENDAMENTOS}.antes-sqlite-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      fs.copyFileSync(ARQ_AGENDAMENTOS, copia, fs.constants.COPYFILE_EXCL);
    }

    const inserir = db.prepare(`
      INSERT INTO agendamentos
        (slot_id, horario_real, estado, expires_at, payload_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const now = new Date();
    for (const antigo of antigos) {
      if (!antigo || !antigo.slotId || !antigo.data || !antigo.horario) continue;
      const item = normalizarAgendamento(antigo, now);
      const atualizado = item.registradoEm || now.toISOString();
      try {
        inserir.run(
          item.slotId,
          chaveHorarioReal(item.data, item.horario),
          item.estado,
          item.expiresAt,
          JSON.stringify(item),
          atualizado,
        );
      } catch (erro) {
        if (!String(erro && erro.message).includes("UNIQUE constraint failed")) throw erro;
        if (db.prepare("SELECT 1 FROM agendamentos WHERE slot_id = ?").get(item.slotId)) continue;
        // JSON antigo já podia conter grade + extra no mesmo momento. A primeira reserva
        // permanece ativa; a duplicada é preservada para auditoria, mas nasce vencida.
        item.estado = "vencido";
        item.pago = false;
        item.expiresAt = null;
        item.vencidoEm = now.toISOString();
        inserir.run(item.slotId, chaveHorarioReal(item.data, item.horario), item.estado, null, JSON.stringify(item), now.toISOString());
      }
    }
    db.prepare("INSERT INTO agenda_meta (chave, valor) VALUES (?, ?)")
      .run("json_importado_v1", now.toISOString());
  });
  vencerReservasNoBanco(db, new Date(), false);
  exportarAgendaLegada(db);
}

function vencerReservasNoBanco(db, now = new Date(), exportar = true) {
  const iso = now.toISOString();
  const existe = db.prepare(`
    SELECT 1 FROM agendamentos
     WHERE estado = 'reservado' AND expires_at IS NOT NULL AND expires_at <= ?
     LIMIT 1
  `).get(iso);
  if (!existe) return 0;
  const resultado = emTransacao(db, () => db.prepare(`
    UPDATE agendamentos
       SET estado = 'vencido', expires_at = NULL, updated_at = ?
     WHERE estado = 'reservado' AND expires_at IS NOT NULL AND expires_at <= ?
  `).run(iso, iso));
  if (exportar && Number(resultado.changes) > 0) exportarAgendaLegada(db);
  return Number(resultado.changes);
}

function listarDoBanco({ incluirInativos = false, now = new Date() } = {}) {
  const db = iniciarBancoAgendamentos();
  vencerReservasNoBanco(db, now);
  const sql = incluirInativos
    ? "SELECT * FROM agendamentos ORDER BY rowid"
    : "SELECT * FROM agendamentos WHERE estado IN ('reservado','pago') ORDER BY rowid";
  return db.prepare(sql).all().map(materializarLinha);
}

function comLockDeExportacao(trabalho) {
  const lock = `${ARQ_AGENDAMENTOS}.export.lock`;
  return comLockArquivo(lock, trabalho, "exportação da agenda");
}

function exportarAgendaLegada(db = iniciarBancoAgendamentos()) {
  comLockDeExportacao(() => {
    // A consulta acontece DEPOIS de obter o lock: se outro processo já terminou uma
    // atualização, este espelho necessariamente inclui a versão mais nova também.
    const ativos = db.prepare("SELECT * FROM agendamentos WHERE estado IN ('reservado','pago') ORDER BY rowid")
      .all().map(materializarLinha);
    escreverJSON(ARQ_AGENDAMENTOS, ativos);
    reescreverCSV(ativos);
  });
}

function lerAgendamentos(now = new Date()) {
  return listarDoBanco({ now });
}

function lerTodosAgendamentos(now = new Date()) {
  return listarDoBanco({ incluirInativos: true, now });
}

function atualizarAgendamento(slotId, alterar) {
  const db = iniciarBancoAgendamentos();
  vencerReservasNoBanco(db, new Date());
  const resultado = emTransacao(db, () => {
    const linha = db.prepare("SELECT * FROM agendamentos WHERE slot_id = ?").get(slotId);
    if (!linha) return null;
    const item = materializarLinha(linha);
    const alterado = alterar(item);
    if (alterado === false) return false;
    const final = normalizarAgendamento(item);
    const agora = new Date().toISOString();
    db.prepare(`
      UPDATE agendamentos
         SET horario_real = ?, estado = ?, expires_at = ?, payload_json = ?, updated_at = ?
       WHERE slot_id = ?
    `).run(chaveHorarioReal(final.data, final.horario), final.estado, final.expiresAt, JSON.stringify(final), agora, slotId);
    return final;
  });
  if (resultado !== null && resultado !== false) exportarAgendaLegada(db);
  return resultado;
}

function vencerReservas(now = new Date()) {
  return vencerReservasNoBanco(iniciarBancoAgendamentos(), now);
}

function listarVencimentosPendentesDeLimpeza(now = new Date()) {
  vencerReservas(now);
  return lerTodosAgendamentos().filter((a) => a.estado === "vencido" && !a.vencimentoSincronizadoEm);
}

function marcarVencimentoSincronizado(slotId, detalhes = null) {
  const atualizado = atualizarAgendamento(slotId, (item) => {
    if (item.estado !== "vencido") return false;
    item.vencimentoSincronizadoEm = new Date().toISOString();
    item.vencimentoSincronizacao = detalhes || null;
  });
  return !!atualizado;
}

function fecharBancoAgendamentosParaTeste() {
  if (!bancoAgendamentos) return;
  bancoAgendamentos.close();
  bancoAgendamentos = null;
}

// Dias bloqueados contam como "ocupados" pra todos os horários daquele dia — assim o
// resto do sistema (consultar_horarios, doisSeguidos, urgente etc.) nunca precisa saber
// que bloqueio existe, só enxerga que não sobrou vaga nesse dia. Reservas já feitas
// num dia que depois foi bloqueado continuam valendo (bloqueio só afeta vaga nova).
function idsOcupados(now = new Date()) {
  // A agenda pergunta "quais vagas da grade estão ocupadas?", não "quais são os IDs das
  // consultas?". Separar os dois permite reservar a mesma vaga novamente depois de um
  // cancelamento/vencimento sem reutilizar a identidade nem as chaves dos efeitos externos.
  const reais = lerAgendamentos(now).map((a) => a.agendaSlotId || a.slotId);
  const bloqueios = new Set(lerBloqueios());
  const dosBloqueios = bloqueios.size === 0
    ? []
    : slotsPossiveisComExtras(now).filter((s) => bloqueios.has(s.date)).map((s) => s.id);
  return new Set([...reais, ...dosBloqueios, ...lerBloqueiosHorarios()]);
}

// Bloqueio de um horário específico (não o dia inteiro) — pra quando só um horário
// precisa sair de circulação (ex: compromisso pessoal do Dr. Bruno naquele horário).
function lerBloqueiosHorarios() {
  return lerJSON(ARQ_BLOQUEIOS_HORARIOS, []);
}

function alternarBloqueioHorario(slotId) {
  return atualizarJSON(ARQ_BLOQUEIOS_HORARIOS, [], (lista) => {
    const idx = lista.indexOf(slotId);
    if (idx >= 0) lista.splice(idx, 1);
    else lista.push(slotId);
    return lista;
  });
}

// HORÁRIOS EXTRAS — horários liberados na mão pelo painel, fora da grade padrão do
// consultório (ex: uma sexta à tarde). Ficam guardados como {data, hora} e viram slots
// no mesmo formato dos da grade, pra todo o resto do sistema tratar igual: a Carla pode
// oferecer e confirmar, e o painel pode bloquear/remover.
function lerHorariosExtras() {
  return lerJSON(ARQ_HORARIOS_EXTRAS, []);
}

// Monta um slot no mesmo formato dos gerados pela grade padrão ({id, date, time, label}).
// O id leva o prefixo "extra-" pra nunca colidir com um id da grade.
function slotDeExtra({ data, hora }) {
  const [ano, mes, dia] = data.split("-").map(Number);
  const nomesDia = (global.CARLA_CONFIG && global.CARLA_CONFIG.nomesDiaSemana) || [];
  const nomeDia = nomesDia[new Date(ano, mes - 1, dia).getDay()] || "";
  const horaLabel = typeof Agenda.formatHora === "function" ? Agenda.formatHora(hora) : hora;
  return {
    id: `extra-${data}-${hora}`,
    date: data,
    time: hora,
    label: `${nomeDia} (${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}) às ${horaLabel}`,
    extra: true,
  };
}

// Slots extras que ainda fazem sentido oferecer: só os que não passaram. Ordenados no
// tempo. Não filtra ocupado/bloqueado — quem chama cuida disso (igual à grade padrão).
function listarSlotsExtras(now = new Date()) {
  return lerHorariosExtras()
    .map(slotDeExtra)
    .filter((s) => {
      const [ano, mes, dia] = s.date.split("-").map(Number);
      const [h, m] = s.time.split(":").map(Number);
      return new Date(ano, mes - 1, dia, h, m) > now;
    })
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

// A grade padrão MAIS os horários extras — é o que o resto do sistema deve usar como
// "todos os horários que existem", pra um extra poder ser oferecido e confirmado igual
// a qualquer outro.
function slotsPossiveisComExtras(now = new Date()) {
  const unicos = new Map();
  // A grade vem primeiro: se alguém abriu um extra exatamente em cima dela, preservamos o
  // slot canônico da grade e descartamos só a representação duplicada do extra.
  for (const slot of [...Agenda.gerarSlotsPossiveis(now), ...listarSlotsExtras(now)]) {
    const chave = chaveHorarioReal(slot.date, slot.time);
    if (!unicos.has(chave)) unicos.set(chave, slot);
  }
  return [...unicos.values()];
}

// Extras realmente livres pra oferecer: tira os já ocupados/bloqueados e, quando pedido,
// filtra por dia da semana, período ou data específica (mesmos critérios da grade).
function extrasDisponiveis(now = new Date(), ocupados = new Set(), filtros = {}) {
  const { diaPreferido = null, periodo = null, dataPreferida = null } = filtros;
  const bloqueados = new Set(lerBloqueios());
  const grade = new Set(Agenda.gerarSlotsPossiveis(now).map((s) => chaveHorarioReal(s.date, s.time)));
  return listarSlotsExtras(now).filter((s) => {
    if (grade.has(chaveHorarioReal(s.date, s.time))) return false;
    if (ocupados.has(s.id)) return false;
    if (bloqueados.has(s.date)) return false;
    if (dataPreferida && s.date !== dataPreferida) return false;
    if (diaPreferido !== null) {
      const [ano, mes, dia] = s.date.split("-").map(Number);
      if (new Date(ano, mes - 1, dia).getDay() !== diaPreferido) return false;
    }
    if (periodo) {
      const hora = Number(s.time.split(":")[0]);
      if (periodo === "manha" && hora >= 12) return false;
      if (periodo === "tarde" && hora < 12) return false;
    }
    return true;
  });
}

function adicionarHorarioExtra(data, hora) {
  return atualizarJSON(ARQ_HORARIOS_EXTRAS, [], (lista) => {
    if (!lista.some((e) => e.data === data && e.hora === hora)) {
      lista.push({ data, hora });
    }
    return lista;
  });
}

function removerHorarioExtra(slotId) {
  return atualizarJSON(ARQ_HORARIOS_EXTRAS, [], (lista) => {
    for (let i = lista.length - 1; i >= 0; i--) {
      if (`extra-${lista[i].data}-${lista[i].hora}` === slotId) lista.splice(i, 1);
    }
    return lista;
  });
}

// Todos os horários de um dia específico, já cruzados com agendamento real, bloqueio do
// dia inteiro e bloqueio individual — pro painel mostrar e deixar bloquear um por um.
// Inclui os horários extras liberados na mão pra esse dia.
function listarHorariosDoDia(dataStr, now = new Date()) {
  const agendamentos = lerAgendamentos(now);
  const diaTodoBloqueado = lerBloqueios().includes(dataStr);
  const bloqueiosHorarios = new Set(lerBloqueiosHorarios());
  const horarios = slotsPossiveisComExtras(now)
    .filter((s) => s.date === dataStr)
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((s) => {
      const agendamento = agendamentos.find((a) =>
        (a.agendaSlotId || a.slotId) === s.id
          || chaveHorarioReal(a.data, a.horario) === chaveHorarioReal(s.date, s.time));
      return {
        slotId: s.id,
        time: s.time,
        ocupado: !!agendamento,
        responsavel: agendamento ? agendamento.responsavel : null,
        crianca: agendamento ? agendamento.crianca : null,
        bloqueado: diaTodoBloqueado || bloqueiosHorarios.has(s.id),
        extra: !!s.extra,
      };
    });
  return { diaTodoBloqueado, horarios };
}

function lerBloqueios() {
  return lerJSON(ARQ_BLOQUEIOS, []);
}

// Alterna o bloqueio de um dia (AAAA-MM-DD): se já estava bloqueado, desbloqueia; senão,
// bloqueia. Retorna a lista atualizada de dias bloqueados.
function alternarBloqueioDia(data) {
  return atualizarJSON(ARQ_BLOQUEIOS, [], (lista) => {
    const idx = lista.indexOf(data);
    if (idx >= 0) lista.splice(idx, 1);
    else lista.push(data);
    return lista;
  });
}

function formatarDataBR(isoDate) {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function reescreverCSV(lista) {
  const linhas = [
    // As duas últimas colunas costumam vir vazias: só são preenchidas quando a família
    // passa os dados depois da confirmação, e passar é opcional. Ficam no fim de
    // propósito, pra ordem das colunas antigas não mudar pra quem já usa esse arquivo.
    ["Nome do responsável", "Nome da criança", "Telefone", "Data da consulta", "Horário", "Registrado em", "E-mail do responsável", "Nascimento da criança", "Pago"],
    ...lista.map((a) => [
      a.responsavel, a.crianca, a.telefone, formatarDataBR(a.data), a.horario,
      new Date(a.registradoEm).toLocaleString("pt-BR"),
      a.responsavelEmail || "", a.criancaDataNascimento ? formatarDataBR(a.criancaDataNascimento) : "",
      a.pago ? "sim" : "não",
    ]),
  ];
  const csv = linhas.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  escreverTextoAtomico(ARQ_AGENDAMENTOS_CSV, "﻿" + csv);
}

// E-mail do responsável e data de nascimento da criança que a família mandou ANTES de
// existir um agendamento pra ligar. Acontece o tempo todo: a Carla pede o nome do
// responsável e da criança, e a família emenda a data de nascimento na mesma mensagem,
// antes de escolher horário. Sem este bolso o dado sumia — e a Carla ainda respondia
// "anotado". Fica guardado por telefone até a reserva acontecer, e é consumido lá.
function guardarDadosPendentes(telefone, { email = null, dataNascimento = null } = {}) {
  return atualizarJSON(ARQ_DADOS_PENDENTES, {}, (todos) => {
    const atual = todos[telefone] || {};
    if (email) atual.email = email;
    if (dataNascimento) atual.dataNascimento = dataNascimento;
    atual.registradoEm = new Date().toISOString();
    todos[telefone] = atual;
    return { ...atual };
  });
}

function lerDadosPendentes(telefone) {
  return lerJSON(ARQ_DADOS_PENDENTES, {})[telefone] || null;
}

function limparDadosPendentes(telefone) {
  return atualizarJSON(ARQ_DADOS_PENDENTES, {}, (todos) => {
    if (!todos[telefone]) return false;
    delete todos[telefone];
    return true;
  });
}

// Retorna false se o horário já tiver sido reservado por outra família (nunca deixa
// duplicar). Quando dá certo devolve o agendamento criado, porque quem chama precisa
// saber se veio e-mail/nascimento junto (do bolso de pendentes) pra mandar pro prontuário.
function reservar({ slot, responsavel, crianca, telefone, googleEventId = null, expiraEm = null, expiresAt = null }) {
  // O que a família adiantou antes de ter horário entra aqui, no agendamento certo.
  const pendentes = lerDadosPendentes(telefone);
  const agora = new Date();
  const expiracaoRecebida = new Date(expiresAt || expiraEm || "");
  const expiracao = Number.isNaN(expiracaoRecebida.getTime())
    ? limiteDePagamento({ data: slot.date, horario: slot.time }, agora)
    : expiracaoRecebida;
  const item = {
    // slotId é a identidade desta RESERVA e nunca volta a ser usado. agendaSlotId é a vaga
    // da grade, que pode ser ocupada novamente quando esta reserva ficar inativa.
    slotId: `reserva-${crypto.randomUUID()}`,
    agendaSlotId: slot.id,
    data: slot.date,
    horario: slot.time,
    diaLabel: slot.label,
    responsavel,
    crianca,
    telefone,
    registradoEm: agora.toISOString(),
    lembretes: { semanaAntes: false, diaDaConsulta: false },
    googleEventId,
    appAgendamentoId: null,
    responsavelEmail: (pendentes && pendentes.email) || null,
    criancaDataNascimento: (pendentes && pendentes.dataNascimento) || null,
    // Reservar não confirma mais nada: quem confirma é o pagamento (ver
    // prazo-de-pagamento.js). Nasce false e só o Dr. Bruno vira, pelo painel, porque não
    // existe integração que avise que o Pix caiu.
    pago: false,
    estado: "reservado",
    expiresAt: expiracao.toISOString(),
    // Permite ao reconciliador distinguir reservas novas, que devem ter efeitos duráveis,
    // de registros legados/manuais que podem já existir fora daqui sem IDs locais.
    integracoesDuraveis: true,
  };
  const db = iniciarBancoAgendamentos();
  vencerReservasNoBanco(db, agora);
  try {
    emTransacao(db, () => {
      db.prepare(`
        INSERT INTO agendamentos
          (slot_id, horario_real, estado, expires_at, payload_json, updated_at)
        VALUES (?, ?, 'reservado', ?, ?, ?)
      `).run(
        item.slotId,
        chaveHorarioReal(item.data, item.horario),
        item.expiresAt,
        JSON.stringify(item),
        agora.toISOString(),
      );
    });
  } catch (erro) {
    if (String(erro && erro.message).includes("UNIQUE constraint failed")) return false;
    throw erro;
  }
  exportarAgendaLegada(db);
  if (pendentes) limparDadosPendentes(telefone);
  return item;
}

// Preenche o id do registro criado no Sistema Pediátrico Integrado depois que o envio (fora
// do fluxo síncrono do agendamento) responde — assim dá pra cancelar lá também depois.
function definirAppAgendamentoId(slotId, appAgendamentoId) {
  const atualizado = atualizarAgendamento(slotId, (item) => {
    item.appAgendamentoId = appAgendamentoId;
  });
  return atualizado || undefined;
}

// Mesmo contrato do vínculo com o SPI, agora para o Google Calendar. A criação externa é
// assíncrona e pode terminar depois de a família cancelar; por isso o setter aceita também
// registros inativos e preserva o ID no histórico. O cancelamento durável encontra esse ID
// mesmo quando os efeitos terminam fora de ordem.
function definirGoogleEventId(slotId, googleEventId) {
  const atualizado = atualizarAgendamento(slotId, (item) => {
    item.googleEventId = googleEventId;
  });
  return atualizado || undefined;
}

// O cancelamento local e a gravação na caixa durável são dois arquivos diferentes. Este
// marcador permite ao painel retomar a segunda metade depois de uma queda exatamente entre
// as duas escritas. Os efeitos têm chave idempotente, então repetir o enfileiramento é seguro.
function listarCancelamentosPendentesDeFila() {
  return lerTodosAgendamentos().filter((a) => a.estado === "cancelado" && !a.cancelamentoEnfileiradoEm);
}

function marcarCancelamentoEnfileirado(slotId, detalhes = null) {
  const atualizado = atualizarAgendamento(slotId, (item) => {
    if (item.estado !== "cancelado") return false;
    item.cancelamentoEnfileiradoEm = new Date().toISOString();
    item.cancelamentoEnfileirado = detalhes || null;
  });
  return !!atualizado;
}

// Agendamentos com telefone de verdade (não placeholder tipo "(a confirmar)") que ainda não
// receberam o lembrete do tipo pedido e cuja data bate com o alvo de hoje ("diaDaConsulta" =
// hoje; "semanaAntes" = daqui a 7 dias).
function agendamentosProntosParaLembrete(hojeStr, tipo) {
  let dataAlvo = hojeStr;
  if (tipo === "semanaAntes") {
    const d = new Date(hojeStr + "T00:00:00");
    d.setDate(d.getDate() + 7);
    dataAlvo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return lerAgendamentos().filter((a) =>
    typeof a.telefone === "string" && a.telefone.startsWith("+")
    && a.estado === "pago"
    && a.data === dataAlvo
    && !(a.lembretes && a.lembretes[tipo])
  );
}

function marcarLembreteEnviado(slotId, tipo) {
  const atualizado = atualizarAgendamento(slotId, (item) => {
    if (item.estado !== "pago") return false;
    item.lembretes = { semanaAntes: false, diaDaConsulta: false, ...(item.lembretes || {}), [tipo]: true };
  });
  return !!atualizado;
}

// Guarda e-mail do responsável e data de nascimento da criança no agendamento mais
// recente desse telefone. É o que vai alimentar a criação do portal da criança no
// Sistema Pediátrico Integrado.
//
// Devolve o AGENDAMENTO (não só `true`) porque quem chama precisa do appAgendamentoId pra
// mandar esses dados pro prontuário, e é aqui que se sabe em qual agendamento eles
// entraram. Continua devolvendo `false` quando não há agendamento pra ligar, então um
// `if (!guardado)` do lado de quem chama segue valendo.
function registrarDadosDoPacientePorSlot(slotId, { email = null, dataNascimento = null } = {}) {
  if (!slotId) return false;
  const encontrado = acharAgendamentoPorSlot(slotId);
  if (!encontrado) return false;
  const emailNovo = !!email && email !== encontrado.responsavelEmail;
  const dataNova = !!dataNascimento && dataNascimento !== encontrado.criancaDataNascimento;
  if (!emailNovo && !dataNova) return { semNovidade: true, agendamento: encontrado };

  return atualizarAgendamento(slotId, (item) => {
    if (!ESTADOS_ATIVOS.has(item.estado)) return false;
    if (emailNovo) item.responsavelEmail = email;
    if (dataNova) item.criancaDataNascimento = dataNascimento;
  }) || false;
}

function registrarDadosDoPaciente(
  telefone,
  { email = null, dataNascimento = null, slotId: slotIdLegado = null } = {},
  { slotId = null } = {},
) {
  // O terceiro argumento é o contrato novo. Aceitar slotId dentro dos dados deixa a
  // transição compatível com chamadas que já tenham começado a adotar a identidade antes
  // desta assinatura, sem voltar ao perigoso "pega o mais recente".
  const alvoExplicito = slotId || slotIdLegado;
  if (alvoExplicito) return registrarDadosDoPacientePorSlot(alvoExplicito, { email, dataNascimento });
  const candidatos = lerAgendamentos().filter((a) => a.telefone === telefone);
  const item = candidatos[0] || null;
  // Sem agendamento ainda: guarda no bolso de pendentes em vez de perder o dado. O
  // `pendente: true` avisa quem chamou que não há o que mandar pro prontuário AGORA —
  // isso acontece na reserva, quando o agendamento finalmente existe.
  if (!item) {
    guardarDadosPendentes(telefone, { email, dataNascimento });
    return { pendente: true };
  }
  // Compatibilidade segura: telefone sozinho continua funcionando quando só existe uma
  // consulta ativa. Com irmãos, escolher silenciosamente seria pior que pedir contexto.
  if (candidatos.length > 1) {
    return {
      ambiguo: true,
      motivo: "Há mais de um agendamento ativo neste telefone; informe slotId.",
      agendamentos: candidatos.map((a) => ({ slotId: a.slotId, crianca: a.crianca, data: a.data, horario: a.horario })),
    };
  }
  // Nada de novo: a Carla reviu a conversa, achou o e-mail que ELA MESMA escreveu numa
  // mensagem anterior e chamou a ferramenta de novo com o mesmo dado. Gravar de novo não
  // faz mal, mas quem chama dispara um WhatsApp pro Dr. Bruno a cada gravação — e ele
  // recebia o mesmo aviso duas vezes. Aqui a repetição morre, no código, sem depender do
  // modelo perceber que já tinha feito isso.
  return registrarDadosDoPacientePorSlot(item.slotId, { email, dataNascimento });
}

// Acha o agendamento mais recente de um e-mail de responsável. É como o prontuário
// identifica a família quando avisa que o portal foi liberado: lá ele conhece o e-mail,
// não o telefone do WhatsApp. Comparação em minúsculas e sem espaços dos dois lados,
// porque o e-mail foi digitado à mão numa conversa.
function acharAgendamentoPorEmail(email) {
  const alvo = String(email || "").trim().toLowerCase();
  if (!alvo) return null;
  const lista = lerAgendamentos();
  return [...lista].reverse().find((a) => String(a.responsavelEmail || "").trim().toLowerCase() === alvo) || null;
}

// Marca que a família já foi avisada do portal, pra um segundo toque no botão do
// prontuário não render uma segunda mensagem igual pra ela.
// Liga e desliga o "pago" de um agendamento. Só o Dr. Bruno mexe nisso, pelo painel: não
// existe integração que avise quando o Pix cai, então a única fonte de verdade é ele
// olhando o extrato. Desligar tem que funcionar igual a ligar, porque errar a linha do
// clique é o tipo de coisa que acontece no celular.
function alterarPagamento(slotId, pago, detalhes = null) {
  const agora = new Date();
  let semMudanca = false;
  const atualizado = atualizarAgendamento(slotId, (item) => {
    if (!ESTADOS_ATIVOS.has(item.estado)) return false;
    const jaEstaComoPedido = pago ? item.estado === "pago" : item.estado === "reservado";
    if (jaEstaComoPedido) {
      semMudanca = true;
      return false;
    }
    item.estado = pago ? "pago" : "reservado";
    item.pago = !!pago;
    item.pagoEm = item.pago ? agora.toISOString() : null;
    item.pagamento = item.pago && detalhes ? detalhes : null;
    item.expiresAt = item.pago ? null : limiteDePagamento(item, agora).toISOString();
    // Se um clique em "Pago" foi desfeito, um pagamento futuro é uma confirmação nova.
    // A marca antiga não pode impedir a nova mensagem, e uma confirmação ainda na caixa de
    // saída não pode ser entregue depois que o pagamento deixou de valer.
    if (!item.pago) item.pagamentoAvisadoEm = null;
  });
  if (!atualizado && !semMudanca) return { ok: false, alterado: false, agendamento: null };
  if (!pago && !semMudanca) removerMensagemPendentePorChave(`pagamento:${slotId}`);
  return {
    ok: true,
    alterado: !semMudanca,
    agendamento: atualizado || acharAgendamentoPorSlot(slotId),
  };
}

function marcarPagamento(slotId, pago, detalhes = null) {
  return alterarPagamento(slotId, pago, detalhes).ok;
}

// Marca que a família já recebeu a mensagem de "pagamento confirmado". Sem isso, um
// clique repetido no botão do painel mandaria a mesma mensagem de novo.
function marcarPagamentoAvisado(slotId) {
  return !!atualizarAgendamento(slotId, (item) => {
    if (item.estado !== "pago") return false;
    if (item.pagamentoAvisadoEm) return false;
    item.pagamentoAvisadoEm = new Date().toISOString();
  });
}

function acharAgendamentoPorSlot(slotId) {
  return lerAgendamentos().find((a) => a.slotId === slotId) || null;
}

function selecionarAgendamento({ slotId = null, telefone = null, email = null, incluirInativos = false } = {}) {
  const lista = incluirInativos ? lerTodosAgendamentos() : lerAgendamentos();
  if (slotId) return lista.find((a) => a.slotId === slotId) || null;
  if (email) {
    const alvo = String(email).trim().toLowerCase();
    return [...lista].reverse().find((a) => String(a.responsavelEmail || "").trim().toLowerCase() === alvo) || null;
  }
  if (telefone) return [...lista].reverse().find((a) => a.telefone === telefone) || null;
  return null;
}

function marcarPortalAvisado(slotId) {
  return !!atualizarAgendamento(slotId, (item) => {
    if (!ESTADOS_ATIVOS.has(item.estado)) return false;
    if (item.portalAvisadoEm) return false;
    item.portalAvisadoEm = new Date().toISOString();
  });
}

// Mesma coisa para o guia. Marca separada da do portal de propósito: são dois envios
// independentes, e a família pode receber um sem o outro (o portal é do consultório, o
// guia é um produto). Uma marca só faria o segundo botão sumir junto com o primeiro.
function marcarGuiaAvisado(slotId) {
  return !!atualizarAgendamento(slotId, (item) => {
    if (!ESTADOS_ATIVOS.has(item.estado)) return false;
    if (item.guiaAvisadoEm) return false;
    item.guiaAvisadoEm = new Date().toISOString();
  });
}

// Cancela um agendamento pelo slotId. Ele some das consultas ativas, mas fica no banco com
// estado cancelado para auditoria. Retorna o registro (inclui ids externos para limpeza),
// ou null se não encontrar/ele já estiver inativo.
function cancelarAgendamento(slotId) {
  const removido = acharAgendamentoPorSlot(slotId);
  if (!removido) return null;
  const agora = new Date().toISOString();
  const cancelado = atualizarAgendamento(slotId, (item) => {
    item.estado = "cancelado";
    item.pago = false;
    item.expiresAt = null;
    item.canceladoEm = agora;
  });
  return cancelado || null;
}

function lerAlertas() {
  return lerJSON(ARQ_ALERTAS, []);
}

// Um alerta pode carregar uma PERGUNTA objetiva pro Dr. Bruno, com resposta sim ou não. Aí
// ele responde pelo painel e a Carla continua a conversa sozinha, em vez de ele ter que
// assumir e digitar. Sem pergunta, é alerta simples de sempre.
//
// dataPedida e horaPedida só existem quando a pergunta é sobre abrir um horário que a grade
// não tem. Com elas o botão "Sim" do painel cria o horário extra junto, senão a Carla
// prometeria um horário que a ferramenta ia recusar na hora de marcar.
function registrarAlertaUrgencia({ telefone, mensagem, tipo = "emergencia", pergunta = null, dataPedida = null, horaPedida = null }) {
  const registro = {
    // Precisa de identidade pra o painel conseguir responder um alerta específico. Os alertas
    // antigos não têm, e tudo bem: não dá pra responder alerta de antes desta mudança.
    id: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
    telefone, mensagem, tipo, quando: new Date().toISOString(),
  };
  if (pergunta) {
    registro.pergunta = String(pergunta).slice(0, 300);
    if (dataPedida) registro.dataPedida = dataPedida;
    if (horaPedida) registro.horaPedida = horaPedida;
  }
  atualizarJSON(ARQ_ALERTAS, [], (lista) => { lista.push(registro); });
  return registro;
}

function acharAlerta(id) {
  return lerAlertas().find((a) => a.id === id) || null;
}

// Grava a resposta do Dr. Bruno. Devolve null se o alerta não existe, e jaRespondido se já
// foi respondido: o painel abre no celular e no computador, e clique repetido acontece. Sem
// esta trava a família receberia duas mensagens dizendo a mesma coisa.
function responderAlerta(id, resposta) {
  return atualizarJSON(ARQ_ALERTAS, [], (lista) => {
    const alerta = lista.find((a) => a.id === id);
    if (!alerta) return null;
    if (alerta.respondidoEm) return { ...alerta, jaRespondido: true };
    alerta.respondidoEm = new Date().toISOString();
    alerta.resposta = String(resposta == null ? "" : resposta).trim().slice(0, 300);
    return { ...alerta };
  });
}

function limparAlertas() {
  atualizarJSON(ARQ_ALERTAS, [], (lista) => { lista.splice(0, lista.length); });
}

// Sessões por telefone: pra Carla não "esquecer" uma conversa em andamento se o bot reiniciar.
function lerSessoes() {
  return lerJSON(ARQ_SESSOES, {});
}

function obterSessao(telefone) {
  const sessoes = lerSessoes();
  return sessoes[telefone] || null;
}

// Quanto tempo de silêncio faz uma conversa deixar de ser "a mesma conversa". Pausa de
// verdade num atendimento é de minutos; quem volta horas depois está começando outro
// assunto, e continuar de onde parou dá erro grave — ver historicoExpirou.
const CONVERSA_EXPIRA_MS = 4 * 60 * 60 * 1000; // 4 horas

// O histórico guardava as últimas 24 mensagens SEM olhar quando foram. Uma família que
// falou às 14h e voltou às 21h recebia a Carla continuando o assunto da tarde: ela
// retomou um "Pix ou cartão?" pendente de outra consulta e, pior, confirmou agendamento
// com o nome da criança ERRADA, lido do histórico velho em vez da conversa de agora.
// Devolve true quando o histórico precisa ser descartado antes de responder.
function historicoExpirou(sessao, now = new Date()) {
  if (!sessao || !sessao.historico || !sessao.historico.length) return false;
  if (!sessao.ultimaAtividade) return false;
  const ultima = new Date(sessao.ultimaAtividade).getTime();
  if (Number.isNaN(ultima)) return false;
  return now.getTime() - ultima > CONVERSA_EXPIRA_MS;
}

function salvarSessao(telefone, sessao) {
  atualizarJSON(ARQ_SESSOES, {}, (sessoes) => { sessoes[telefone] = sessao; });
}

// Tira o telefone do estado "aguardando humano" pelo painel — útil quando você já resolveu
// por fora e quer que a Carla volte a responder esse número sozinha antes das 2h automáticas.
function retomarAtendimento(telefone) {
  return atualizarJSON(ARQ_SESSOES, {}, (sessoes) => {
    const sessao = sessoes[telefone];
    if (!sessao) return false;
    sessao.aguardandoHumano = false;
    sessao.aguardandoHumanoDesde = null;
    return true;
  });
}

// Apaga a sessão inteira desse telefone (histórico, aguardando humano, último agendamento
// lembrado etc) — a próxima mensagem desse número é tratada como se fosse a primeira vez.
function limparConversa(telefone) {
  return atualizarJSON(ARQ_SESSOES, {}, (sessoes) => delete sessoes[telefone]);
}

// Caixa de saída durável. A sessão pode avançar depois de uma reserva ou cancelamento, mas
// a mensagem que explica isso não pode desaparecer se o WhatsApp falhar ou o processo cair.
function listarMensagensPendentes(telefone = null) {
  const todas = lerJSON(ARQ_MENSAGENS_PENDENTES, []);
  return telefone ? todas.filter((m) => m.telefone === telefone) : todas;
}

function registrarMensagemPendente({ telefone, jid, texto, efeitoAposEnvio = null, chaveIdempotencia = null }) {
  return atualizarJSON(ARQ_MENSAGENS_PENDENTES, [], (lista) => {
    if (chaveIdempotencia) {
      const existente = lista.find((m) => m.chaveIdempotencia === chaveIdempotencia);
      if (existente) return existente;
    }
    const item = {
      id: crypto.randomUUID(),
      telefone,
      jid,
      texto,
      criadaEm: new Date().toISOString(),
      enviadaEm: null,
      tentativas: 0,
      ultimoErro: null,
      efeitoAposEnvio,
      chaveIdempotencia,
    };
    lista.push(item);
    return item;
  });
}

function marcarMensagemPendenteEnviada(id) {
  return atualizarJSON(ARQ_MENSAGENS_PENDENTES, [], (lista) => {
    const item = lista.find((m) => m.id === id);
    if (!item) return null;
    if (!item.enviadaEm) item.enviadaEm = new Date().toISOString();
    item.ultimoErro = null;
    return { ...item };
  });
}

function marcarFalhaMensagemPendente(id, erro) {
  return atualizarJSON(ARQ_MENSAGENS_PENDENTES, [], (lista) => {
    const item = lista.find((m) => m.id === id);
    if (!item) return false;
    item.tentativas = (item.tentativas || 0) + 1;
    item.ultimoErro = String(erro && erro.message ? erro.message : erro || "erro desconhecido").slice(0, 300);
    item.ultimaTentativaEm = new Date().toISOString();
    return true;
  });
}

function removerMensagemPendente(id) {
  return atualizarJSON(ARQ_MENSAGENS_PENDENTES, [], (lista) => {
    const indice = lista.findIndex((m) => m.id === id);
    if (indice < 0) return false;
    lista.splice(indice, 1);
    return true;
  });
}

function removerMensagemPendentePorChave(chaveIdempotencia) {
  if (!chaveIdempotencia) return false;
  return atualizarJSON(ARQ_MENSAGENS_PENDENTES, [], (lista) => {
    const antes = lista.length;
    for (let i = lista.length - 1; i >= 0; i--) {
      if (lista[i].chaveIdempotencia === chaveIdempotencia) lista.splice(i, 1);
    }
    return lista.length !== antes;
  });
}

// Últimos contatos pro painel: um por telefone, ordenado do mais recente pro mais antigo.
// Só entra quem já tem "ultimaAtividade" registrada (server.js carimba isso a cada
// mensagem processada) — sessões antigas sem esse campo simplesmente não aparecem.
function listarContatosRecentes(limite = 20) {
  const sessoes = lerSessoes();
  return Object.entries(sessoes)
    .filter(([, s]) => s && s.ultimaAtividade)
    .map(([telefone, s]) => ({
      telefone,
      ultimaAtividade: s.ultimaAtividade,
      ultimaMensagem: s.ultimaMensagem || "",
      fechou: !!s.ultimoAgendamento,
      aguardandoHumano: !!s.aguardandoHumano,
    }))
    .sort((a, b) => new Date(b.ultimaAtividade) - new Date(a.ultimaAtividade))
    .slice(0, limite);
}

// Contatos conhecidos do WhatsApp. Guarda dois nomes bem diferentes:
// - nomeSalvo: como o Dr. Bruno salvou esse número na agenda do celular dele. Só existe
//   quando o WhatsApp sincroniza os contatos do telefone — e é justamente esse o sinal de
//   que a pessoa já é paciente (ele só salva o nome depois que alguém já passou com ele).
// - pushName: o nome que a PRÓPRIA pessoa escolheu no perfil dela do WhatsApp — qualquer
//   um tem isso, não indica paciente nenhum, é só um apelido de exibição.
// Alimentado pela sincronização de histórico ao conectar, por atualização de contatos, e por
// toda mensagem vista (enviada ou recebida). É só informativo — nunca decide sozinho quem a
// Carla responde ou não, mas o nomeSalvo alimenta o tom de conversa (ver cerebro-ia.js).
function lerContatosWhatsappMapa() {
  return lerJSON(ARQ_CONTATOS_WHATSAPP, {});
}

function registrarContatoWhatsapp(telefone, { nomeSalvo, pushName } = {}) {
  return atualizarJSON(ARQ_CONTATOS_WHATSAPP, {}, (contatos) => {
    const atual = contatos[telefone] || { nomeSalvo: null, pushName: null };
    const novo = {
      ...atual,
      nomeSalvo: nomeSalvo || atual.nomeSalvo || null,
      pushName: pushName || atual.pushName || null,
    };
    if (novo.nomeSalvo === atual.nomeSalvo && novo.pushName === atual.pushName) return false;
    contatos[telefone] = novo;
    return true;
  });
}

// Pacientes marcados manualmente pelo painel — cobre o caso do sinal automático (nome salvo
// no WhatsApp) não ter pego ainda (a sincronização de contatos nem sempre roda de novo numa
// reconexão comum, só na primeira vez que conecta). Some diretamente na decisão de tom da
// Carla, igual o nomeSalvo — ver ehPacienteConhecido.
function lerPacientesManuais() {
  return lerJSON(ARQ_PACIENTES_MANUAIS, []);
}

// Lista de telefones que o painel forçou a NÃO ser paciente, mesmo estando salvos com nome
// na agenda do celular. Sobrepõe a detecção automática por nomeSalvo — assim dá pra fazer a
// Carla tratar de novo como lead novo (primeira vez) alguém que ela detectaria como conhecido.
function lerNaoPacientesManuais() {
  return lerJSON(ARQ_NAO_PACIENTES_MANUAIS, []);
}

// Marca como paciente: tira da lista de "não-paciente" (se estava) e, se não for um contato
// já salvo com nome, adiciona na lista de pacientes manuais. Sempre resulta em paciente.
function marcarPacienteManual(telefone) {
  return comLockArquivo(path.join(DIR_DADOS, "classificacao-paciente.lock"), () => {
    const naoPacientes = lerNaoPacientesManuais().filter((t) => t !== telefone);
    const lista = lerPacientesManuais();
    if (!lista.includes(telefone)) lista.push(telefone);
    escreverJSON(ARQ_NAO_PACIENTES_MANUAIS, naoPacientes);
    escreverJSON(ARQ_PACIENTES_MANUAIS, lista);
    return lista;
  }, "classificação de paciente");
}

// Remove a marcação de paciente: tira da lista de pacientes manuais E adiciona na lista de
// "não-paciente" (que sobrepõe o nomeSalvo). Sempre resulta em não-paciente, mesmo pra quem
// estava salvo com nome na agenda.
function desmarcarPacienteManual(telefone) {
  return comLockArquivo(path.join(DIR_DADOS, "classificacao-paciente.lock"), () => {
    const lista = lerPacientesManuais().filter((t) => t !== telefone);
    const naoPacientes = lerNaoPacientesManuais();
    if (!naoPacientes.includes(telefone)) naoPacientes.push(telefone);
    escreverJSON(ARQ_PACIENTES_MANUAIS, lista);
    escreverJSON(ARQ_NAO_PACIENTES_MANUAIS, naoPacientes);
    return lista;
  }, "classificação de paciente");
}

// Exatamente o que o painel mostra como "Paciente": salvo com nome na agenda do celular do
// Dr. Bruno OU marcado no botão. A lista de "não-paciente" sobrepõe os dois.
//
// É mais estreito que ehPacienteConhecido de propósito: aqui NÃO entra quem só marcou
// consulta. Quem decide isso é quem lê o painel, então tinha que ser o que o painel mostra.
// listarTodosContatos usa esta mesma função, pra a etiqueta na tela e a decisão da Carla não
// poderem separar sem alguém perceber.
function ehPacienteNoPainel(telefone) {
  if (lerNaoPacientesManuais().includes(telefone)) return false;
  const contato = lerContatosWhatsappMapa()[telefone];
  if (contato && contato.nomeSalvo) return true;
  return lerPacientesManuais().includes(telefone);
}

// Se este número já ouviu, alguma vez, que a Carla é o atendimento automático. Fica no
// cadastro do contato e não na sessão de propósito: sessão o painel limpa e expira em 4
// horas, e isto precisa valer pra sempre. Ninguém ouve duas vezes.
function jaSeApresentou(telefone) {
  const contato = lerContatosWhatsappMapa()[telefone];
  return !!(contato && contato.apresentadaEm);
}

function marcarApresentacao(telefone, quando = new Date()) {
  return atualizarJSON(ARQ_CONTATOS_WHATSAPP, {}, (contatos) => {
    const atual = contatos[telefone] || { nomeSalvo: null, pushName: null };
    if (atual.apresentadaEm) return false;
    contatos[telefone] = { ...atual, apresentadaEm: quando.toISOString() };
    return true;
  });
}

// true quando o telefone está salvo com nome na agenda do celular do Dr. Bruno (sinal
// automático) OU foi marcado manualmente como paciente pelo painel — qualquer um dos dois
// já ajusta o tom de abordagem da Carla (ver cerebro-ia.js). A lista de "não-paciente"
// (forçada pelo painel) sobrepõe tudo isso, sempre.
function ehPacienteConhecido(telefone) {
  if (lerNaoPacientesManuais().includes(telefone)) return false;
  const contato = lerContatosWhatsappMapa()[telefone];
  if (contato && contato.nomeSalvo) return true;
  if (lerPacientesManuais().includes(telefone)) return true;
  // Quem marcou consulta com a Carla não é desconhecido, mesmo que o número não esteja
  // salvo na agenda do celular. Sem isto ela se reapresenta ("Aqui é a Carla, secretária
  // do Dr. Bruno...") pra família que ela mesma atendeu ontem — e chegou a fazer isso 27
  // minutos depois de mandar o lembrete da consulta daquele dia.
  return lerAgendamentos().some((a) => a.telefone === telefone);
}

// A consulta mais próxima que ainda vai acontecer nesse telefone (a de hoje conta o dia
// todo). É o que permite a Carla responder "a consulta do Pedro é hoje às 9h30" em vez de
// perguntar como pode ajudar, pra quem ela lembrou de manhã.
function proximaConsultaDoTelefone(telefone, now = new Date()) {
  const hoje = Agenda.toDateStr(now);
  return lerAgendamentos(now)
    .filter((a) => a.telefone === telefone && a.data >= hoje)
    .sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario))[0] || null;
}

// Lista única pro painel: todo contato que a Carla já viu no WhatsApp (mais quem foi marcado
// manualmente como paciente, mesmo sem nunca ter aparecido ainda), cruzado com a sessão
// (última atividade, se fechou consulta, se está aguardando humano) e com o estado de
// silenciado — assim dá pra ver, silenciar e marcar paciente num só lugar, com rolagem.
function listarTodosContatos() {
  const contatosWhatsapp = lerContatosWhatsappMapa();
  const sessoes = lerSessoes();
  const silenciados = new Set(lerContatosSilenciados());
  const pacientesManuais = new Set(lerPacientesManuais());
  const telefones = new Set([...Object.keys(contatosWhatsapp), ...pacientesManuais]);
  const lista = [...telefones].map((telefone) => {
    const info = contatosWhatsapp[telefone] || {};
    const sessao = sessoes[telefone];
    const marcadoManualmente = pacientesManuais.has(telefone);
    // Estado efetivo de paciente. Vem da mesma função que a Carla consulta pra decidir se se
    // apresenta, senão a etiqueta na tela e o comportamento dela podiam discordar em silêncio.
    const ehPaciente = ehPacienteNoPainel(telefone);
    return {
      telefone,
      nome: info.nomeSalvo || info.pushName || null,
      ehPaciente,
      contatoSalvo: ehPaciente,
      marcadoManualmente,
      ultimaAtividade: (sessao && sessao.ultimaAtividade) || null,
      ultimaMensagem: (sessao && sessao.ultimaMensagem) || "",
      fechou: !!(sessao && sessao.ultimoAgendamento),
      aguardandoHumano: !!(sessao && sessao.aguardandoHumano),
      silenciado: silenciados.has(telefone),
    };
  });
  lista.sort((a, b) => {
    if (a.ultimaAtividade && b.ultimaAtividade) return new Date(b.ultimaAtividade) - new Date(a.ultimaAtividade);
    if (a.ultimaAtividade) return -1;
    if (b.ultimaAtividade) return 1;
    return (a.nome || a.telefone).localeCompare(b.nome || b.telefone);
  });
  return lista;
}

// Taxa de conversão simples: quantos telefones que já falaram com a Carla (contatos únicos
// com sessão registrada) resultaram em pelo menos um agendamento de verdade.
function metricasConversao() {
  const sessoes = lerSessoes();
  const totalContatos = Object.keys(sessoes).length;
  const telefonesComAgendamento = new Set(lerAgendamentos().map((a) => a.telefone));
  const totalFechados = telefonesComAgendamento.size;
  const taxa = totalContatos === 0 ? 0 : Math.round((totalFechados / totalContatos) * 100);
  return { totalContatos, totalFechados, taxa };
}

// Números que o Dr. Bruno silenciou manualmente pelo painel (família, amigos, pacientes
// que ele já atende por fora etc) — a Carla nunca responde esses números, mas isso nunca
// tem prioridade sobre a checagem de emergência (ver server.js: emergência sempre primeiro).
function lerContatosSilenciados() {
  return lerJSON(ARQ_SILENCIADOS, []);
}

function contatoSilenciado(telefone) {
  return lerContatosSilenciados().includes(telefone);
}

function silenciarContato(telefone) {
  return atualizarJSON(ARQ_SILENCIADOS, [], (lista) => {
    if (!lista.includes(telefone)) lista.push(telefone);
    return lista;
  });
}

function dessilenciarContato(telefone) {
  return atualizarJSON(ARQ_SILENCIADOS, [], (lista) => {
    for (let i = lista.length - 1; i >= 0; i--) {
      if (lista[i] === telefone) lista.splice(i, 1);
    }
    return lista;
  });
}

module.exports = {
  registrarDadosDoPaciente, registrarDadosDoPacientePorSlot, guardarDadosPendentes, lerDadosPendentes, limparDadosPendentes,
  acharAgendamentoPorEmail, marcarPortalAvisado, marcarGuiaAvisado, marcarPagamento, alterarPagamento, marcarPagamentoAvisado, acharAgendamentoPorSlot, selecionarAgendamento, historicoExpirou, proximaConsultaDoTelefone,
  lerAgendamentos, lerTodosAgendamentos, vencerReservas, listarVencimentosPendentesDeLimpeza, marcarVencimentoSincronizado, idsOcupados, reservar, cancelarAgendamento, definirAppAgendamentoId, definirGoogleEventId,
  listarCancelamentosPendentesDeFila, marcarCancelamentoEnfileirado,
  lerAlertas, registrarAlertaUrgencia, acharAlerta, responderAlerta,
  _fecharBancoAgendamentosParaTeste: fecharBancoAgendamentosParaTeste,
  limparAlertas, formatarDataBR, obterSessao, salvarSessao,
  agendamentosProntosParaLembrete, marcarLembreteEnviado,
  lerBloqueios, alternarBloqueioDia,
  lerBloqueiosHorarios, alternarBloqueioHorario, listarHorariosDoDia,
  lerHorariosExtras, adicionarHorarioExtra, removerHorarioExtra,
  listarSlotsExtras, slotsPossiveisComExtras, extrasDisponiveis,
  listarContatosRecentes, metricasConversao,
  lerContatosSilenciados, contatoSilenciado, silenciarContato, dessilenciarContato,
  registrarContatoWhatsapp, listarTodosContatos, ehPacienteConhecido,
  ehPacienteNoPainel, jaSeApresentou, marcarApresentacao,
  lerPacientesManuais, lerNaoPacientesManuais, marcarPacienteManual, desmarcarPacienteManual,
  retomarAtendimento, limparConversa,
  listarMensagensPendentes, registrarMensagemPendente, marcarMensagemPendenteEnviada,
  marcarFalhaMensagemPendente, removerMensagemPendente, removerMensagemPendentePorChave,
};
