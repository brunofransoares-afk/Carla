"use strict";

process.env.CARLA_LOG_REDACT = "0";
const path = require("path");
const { redigir } = require(path.join(__dirname, "..", "log-seguro.js"));

const casos = [
  ["Contato +5511999999999 e fulano@example.com", "telefone e e-mail", ["+5511999999999", "fulano@example.com"]],
  ["authorization=Bearer abc.def.ghi", "credencial", ["abc.def.ghi"]],
  ['[RECEBIDA] +5511999999999: meu filho João está com febre', "mensagem clínica", ["João", "febre"]],
  ['[FERRAMENTA] registrar_dados({"email":"mae@example.com"})', "argumentos de ferramenta", ["mae@example.com"]],
  ['[AGENDADO] Maria / João em terça-feira 09:30', "nome em agendamento", ["Maria", "João"]],
  ['[LEMBRETE 1 semana antes] 5511999999999 — Pedro em 03/09', "lembrete clínico", ["Pedro", "5511999999999"]],
  ['[PORTAL] Avisei 5511999999999 sobre o portal de Ana', "aviso de portal", ["Ana", "5511999999999"]],
  ['dispositivo 5511999999999:12@s.whatsapp.net', "JID com dispositivo", ["5511999999999"]],
];

let falhas = 0;
for (const [entrada, nome, proibidos] of casos) {
  const saida = redigir(entrada);
  for (const proibido of proibidos) {
    if (saida.includes(proibido)) {
      falhas++;
      console.log(`FALHOU: ${nome} ainda contém ${JSON.stringify(proibido)}: ${saida}`);
    }
  }
}

console.log(`\nlog-seguro: ${casos.length - falhas} passaram, ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
