"use strict";

/*
 * A CONVERSA INTEIRA, de cada número, pra o Dr. Bruno ver e pra Carla poder ler (2026-10-02).
 *
 * O dono: "tem algumas ali que a mensagem continuou comigo respondendo à mão, mas isso não
 * aparece nas últimas mensagens. Se eu reativar esse paciente, a Carla não vai levar em
 * consideração nada que eu escrevi à mão." Ele pediu as duas coisas: ver tudo na ficha (A) e a
 * Carla continuar de onde ele parou (B).
 *
 * POR QUE UM ARQUIVO SEPARADO DA SESSÃO. A sessão é a memória de TRABALHO da Carla: some
 * depois de 4h de silêncio e guarda só as 24 últimas falas, de propósito (ela já retomou um
 * "Pix ou cartão?" de outro assunto com o nome errado de criança). Este registro é outra
 * coisa: é o histórico, não se apaga sozinho, e não é dado pra ela como fala dela. Quando ela
 * lê (B), lê como REGISTRO, num bloco à parte do prompt.
 *
 * QUEM FALOU: "familia", "carla" ou "doutor" (o que ele escreveu no painel ou no celular).
 *
 * LIMITES: 500 mensagens por número e 4000 caracteres por mensagem. Fica em data/, que nunca
 * vai pro repositório (o repositório é público).
 */
const fs = require("fs");
const path = require("path");
const Atomico = require("./arquivo-atomico.js");

const DIR_PADRAO = path.join(__dirname, "data", "conversas");
const LIMITE_MENSAGENS = 500;
const LIMITE_TEXTO = 4000;
const QUEM = new Set(["familia", "carla", "doutor"]);

function arquivoDe(telefone, dir = DIR_PADRAO) {
  const limpo = String(telefone || "").replace(/[^0-9]/g, "");
  if (limpo.length < 8) return null;
  return path.join(dir, `${limpo}.json`);
}

function ler(telefone, { dir = DIR_PADRAO, limite = null } = {}) {
  const arq = arquivoDe(telefone, dir);
  if (!arq) return [];
  const lista = Atomico.lerJSONSeguro(arq, []);
  const valida = Array.isArray(lista) ? lista.filter((m) => m && QUEM.has(m.quem) && typeof m.texto === "string") : [];
  return limite ? valida.slice(-limite) : valida;
}

function registrar(telefone, quem, texto, { dir = DIR_PADRAO, em = new Date(), origem = null } = {}) {
  const arq = arquivoDe(telefone, dir);
  const limpo = String(texto == null ? "" : texto).trim().slice(0, LIMITE_TEXTO);
  if (!arq || !QUEM.has(quem) || !limpo) return false;
  try {
    fs.mkdirSync(path.dirname(arq), { recursive: true, mode: 0o700 });
    const lista = ler(telefone, { dir });
    const item = { quem, texto: limpo, em: (em instanceof Date ? em : new Date(em)).toISOString() };
    if (origem) item.origem = origem;
    lista.push(item);
    Atomico.escreverJSONAtomico(arq, lista.slice(-LIMITE_MENSAGENS));
    return true;
  } catch (erro) {
    // O registro é histórico, nunca pode derrubar uma conversa em andamento.
    console.error("[CONVERSA COMPLETA] Não consegui gravar:", erro.message);
    return false;
  }
}

// O TRECHO QUE A CARLA LÊ (parte B). Só existe quando o Dr. Bruno escreveu à mão nessa
// conversa nos últimos 30 dias: sem isso, a memória dela já tem tudo e o bloco seria só custo.
// O tamanho é cortado pelo COMEÇO (as falas mais antigas saem primeiro), porque o limpador
// do prompt corta pelo fim e levaria justamente a parte em que ele assumiu.
const NOME = { familia: "Família", carla: "Carla", doutor: "Dr. Bruno (escrito à mão)" };
const DIAS_QUE_VALE = 30;
const FALAS_NO_TRECHO = 30;
const LIMITE_POR_FALA = 600;
const LIMITE_DO_TRECHO = 8000;

function trechoParaCarla(lista, { agora = new Date(), dias = DIAS_QUE_VALE, falas = FALAS_NO_TRECHO, limite = LIMITE_DO_TRECHO } = {}) {
  const corte = new Date(agora).getTime() - dias * 24 * 60 * 60 * 1000;
  const validas = (Array.isArray(lista) ? lista : []).filter((m) => m && NOME[m.quem] && m.texto);
  const doutorRecente = validas.some((m) => m.quem === "doutor" && new Date(m.em).getTime() >= corte);
  if (!doutorRecente) return null;
  const linhas = validas.slice(-falas).map((m) => {
    const quando = new Date(m.em);
    const dia = Number.isNaN(quando.getTime()) ? "" : ` ${quando.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
    return `[${NOME[m.quem]}${dia}] ${String(m.texto).replace(/\s+/g, " ").trim().slice(0, LIMITE_POR_FALA)}`;
  });
  while (linhas.length > 1 && linhas.join("\n").length > limite) linhas.shift();
  return linhas.join("\n");
}

module.exports = { ler, registrar, arquivoDe, trechoParaCarla, LIMITE_MENSAGENS, LIMITE_TEXTO, DIR_PADRAO, DIAS_QUE_VALE, FALAS_NO_TRECHO, LIMITE_DO_TRECHO };
