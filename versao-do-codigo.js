"use strict";

// Qual commit este processo carregou. Lido UMA vez, quando o processo sobe: é o código que
// está rodando, e não o que está no disco agora (o deploy troca o disco antes de reiniciar).
//
// POR QUE ISTO EXISTE (2026-10-01). O dono marcou Pago e a família recebeu a confirmação que
// já tinha sido tirada do código. Daqui não dá pra ver o servidor, e a dúvida "a VPS está na
// versão nova?" não tinha resposta em lugar nenhum. Agora o painel mostra a versão do painel
// e a do bot, e avisa quando as duas não batem.
const fs = require("fs");
const path = require("path");

function lerCommit(raiz = __dirname) {
  try {
    const git = path.join(raiz, ".git");
    const head = fs.readFileSync(path.join(git, "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head.slice(0, 7);
    const ref = (head.match(/^ref: (.+)$/) || [])[1];
    if (!ref) return null;
    try {
      return fs.readFileSync(path.join(git, ref), "utf8").trim().slice(0, 7);
    } catch {
      const empacotados = fs.readFileSync(path.join(git, "packed-refs"), "utf8");
      const linha = empacotados.split("\n").find((l) => l.endsWith(" " + ref));
      return linha ? linha.slice(0, 7) : null;
    }
  } catch {
    return null;
  }
}

const COMMIT_CARREGADO = lerCommit();

module.exports = { lerCommit, COMMIT_CARREGADO };
