// A pausa pelo celular (#147) aparece no painel: situação, cartão de Hoje e aviso na ficha.
// O dono (2026-10-01): "seria interessante que isso aparecesse no painel, a pessoa silenciada".
"use strict";
const fs = require("fs");
const path = require("path");
const Crm = require(path.join(__dirname, "..", "crm.js"));
const Hoje = require(path.join(__dirname, "..", "painel-hoje.js"));
let ok = 0, falhou = 0;
function checar(cond, nome) { if (cond) ok++; else { falhou++; console.log("  x " + nome); } }

const situacoes = Crm.SITUACOES || (Crm._interno && Crm._interno.SITUACOES) || [];
checar(situacoes.some((s) => s.chave === "pausada_por_voce" && /pausada/i.test(s.rotulo)), "1. existe a situação 'Carla pausada: você escreveu'");

const fonteCrm = fs.readFileSync(path.join(__dirname, "..", "crm.js"), "utf8");
checar(/contato\.aguardandoHumano && contato\.pausadaPeloDoutor\) lista\.push\("pausada_por_voce"\)/.test(fonteCrm), "2. só quando a pausa foi dele");

const fonteStorage = fs.readFileSync(path.join(__dirname, "..", "storage-node.js"), "utf8");
checar((fonteStorage.match(/pausadaPeloDoutor: !!\(/g) || []).length >= 2, "3. o storage leva a pausa ao painel nas duas listas");

const fonteHoje = fs.readFileSync(path.join(__dirname, "..", "painel-hoje.js"), "utf8");
checar(/pausada_por_voce/.test(fonteHoje) && /Carla pausada: você escreveu/.test(fonteHoje), "4. o cartão de Hoje diz que a Carla está pausada");

const tela = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");
checar(/\$\{avisoPausa\}\$\{acoes\}/.test(tela) && /class="aviso-pausa"/.test(tela), "5. a ficha mostra o aviso logo no topo");
checar(!/—/.test(tela.match(/avisoPausa[\s\S]{0,400}/)[0]), "6. sem travessão no aviso");

console.log(`pausa-no-painel: ${ok} passaram, ${falhou} falharam`);
if (falhou) process.exit(1);
