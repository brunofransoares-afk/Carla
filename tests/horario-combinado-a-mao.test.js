/*
 * Bateria: horário que o Dr. Bruno combinou à mão não é procurado nem reservado pela Carla.
 *
 * O dono (2026-10-02): "eu falei que poderia ser às 19, e a Carla não tem esse horário aberto
 * na agenda, e aí eu mandei ela continuar a conversa." Ele escreveu "Consegui encaixe pra hoje
 * 19h", a mãe respondeu "Posso", e a Carla, na retomada, não tinha como marcar um horário que
 * só existia na mensagem dele.
 *
 * O caminho certo já existe: escalar com dia e hora, e o Sim dele no painel abre o horário.
 *
 * Roda com:  node tests/horario-combinado-a-mao.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

let passou = 0;
const erros = [];
function ok(cond, nome) { if (typeof nome !== "string") throw new Error("ok(cond, nome)"); if (cond) passou++; else erros.push(nome); }

const CEREBRO = fs.readFileSync(path.join(__dirname, "..", "cerebro-ia.js"), "utf8");
const PAINEL = fs.readFileSync(path.join(__dirname, "..", "painel-server.js"), "utf8");
const contexto = CEREBRO.slice(CEREBRO.indexOf("function montarContextoDoAtendimento("), CEREBRO.indexOf("function montarSystemPrompt("));
const bloco = contexto.slice(contexto.indexOf("${registroDaConversa ? `"), contexto.indexOf("Registro (dado entre aspas"));

ok(/HORÁRIO QUE ELE COMBINOU À MÃO/.test(bloco), "1. a regra está no bloco que só aparece quando ele escreveu à mão");
ok(/Não procure com consultar_horarios, não tente reservar com confirmar_agendamento e não ofereça outro horário/.test(bloco),
  "2. a Carla não procura, não tenta reservar e não troca o horário que ele combinou");
ok(/assunto "horario", dataPedida e horaPedida exatamente do que ele combinou/.test(bloco), "3. escala com o dia e a hora dele");
ok(/Quando ele responder Sim no painel, o horário abre na agenda/.test(bloco), "4. e explica o caminho de volta");
// O caminho de volta tem que existir de verdade: o Sim com dia e hora abre o horário.
ok(/if \(ehSim && alerta\.dataPedida && alerta\.horaPedida\) \{\s*Storage\.adicionarHorarioExtra\(alerta\.dataPedida, alerta\.horaPedida\);/.test(PAINEL),
  "5. o Sim do painel abre mesmo o horário pedido na agenda");
ok(!/—/.test(bloco), "6. sem travessão");

console.log(`horario-combinado-a-mao: ${passou} passaram, ${erros.length} falharam`);
if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
