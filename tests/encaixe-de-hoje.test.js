/*
 * Bateria: pedido de hoje não é a Carla que responde, é o Dr. Bruno.
 *
 * O dono, em 01/10/2026: "se a mãe questionar de qualquer forma, né? Ah, mas não teria um
 * encaixe? Ou não teria um horário para hoje? ... eu gostaria que a conversa fosse escalada.
 * 'Irei checar alguma possibilidade e te retorno.' E a partir daí não responde mais. Silencia.
 * E aí quando escala para mim, dentro do painel da Carla já deve aparecer as opções possíveis
 * ali de resposta. Consigo encaixar hoje tal horário, e aí um campinho para eu colocar o
 * horário. E a partir do momento que eu autorizo isso, o sistema deve abrir esse horário na
 * agenda e fazer o agendamento. Não dá de louca depois e falar que não sabe desse horário
 * porque não estava registrado."
 *
 * SÃO TRÊS PEÇAS, E A DO MEIO É A QUE QUEBRA SOZINHA:
 *
 *   1. A grade nunca oferece hoje (tests/antecedencia-minima.test.js guarda isso).
 *   2. O painel abre o horário de hoje ANTES de a resposta chegar na Carla.
 *   3. A Carla consulta a agenda de hoje e acha o horário que ele acabou de abrir.
 *
 * A 2 é a frágil: se o horário for aberto depois, ou não for aberto, a Carla consulta e não
 * acha nada, e aí ela diz à família que não tem hoje logo depois de o Dr. Bruno ter dito que
 * tem. Por isso a ordem está testada, e não só o efeito.
 *
 * Roda com:  node tests/encaixe-de-hoje.test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

let passou = 0;
const erros = [];
function ok(cond, msg) { if (cond) { passou++; return; } erros.push(msg); }
function eq(a, b, msg) { ok(a === b, msg + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

const raiz = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const CEREBRO = raiz("cerebro-ia.js");
const SERVER = raiz("server.js");
const PAINEL = raiz("painel-server.js");
const STORAGE = raiz("storage-node.js");
const TELA = raiz("dashboard.html");
const PROMPT = CEREBRO.slice(CEREBRO.indexOf("const PROMPT_ESTAVEL = `"), CEREBRO.indexOf("function montarSystemPrompt("));
const SEM_COMENTARIO = PROMPT.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// ------------------------------------------------- 1. a regra, no prompt
{
  ok(/PEDIDO DE ENCAIXE PRA HOJE:/.test(SEM_COMENTARIO), "1. a regra existe e tem nome");
  ok(/"Irei checar alguma possibilidade e te retorno\."/.test(SEM_COMENTARIO),
    "1b. com a frase que o dono escolheu, literal");
  ok(/E AÍ VOCÊ PARA\./.test(SEM_COMENTARIO) && /A conversa fica pausada até ele responder/.test(SEM_COMENTARIO),
    "1c. e com o silêncio depois, que é metade do pedido");
  ok(/não oferece horário de amanhã "enquanto isso"/.test(SEM_COMENTARIO),
    "1d. incluindo a tentação mais provável: emendar amanhã na mesma mensagem");
  ok(/NÃO chama consultar_horarios pra conferir/.test(SEM_COMENTARIO),
    "1e. ela não consulta pra 'ver se tem': a grade não tem hoje, e consultar só produziria um não que não é dela");
  ok(/assunto "encaixe"/.test(SEM_COMENTARIO) && /dataPedida preenchida com a data de HOJE/.test(SEM_COMENTARIO),
    "1f. o escalonamento leva o assunto e o dia");
  ok(/o nome da criança e o nome de quem vai levar/.test(SEM_COMENTARIO),
    "1g. e ela colhe o que falta antes, senão o Dr. Bruno decide no escuro");
  ok(/chame consultar_horarios com data = hoje/.test(SEM_COMENTARIO),
    "2. quando a resposta chega, ela consulta a agenda de hoje");
  ok(/NUNCA diga que não conhece esse horário/.test(SEM_COMENTARIO),
    "2b. e é proibida de dizer que não conhece o horário que ele acabou de abrir");
  ok(/NUNCA marque sem passar pela ferramenta/.test(SEM_COMENTARIO),
    "2c. mas também não marca de cabeça: o horário existe, então a ferramenta devolve");
  ok(/A AGENDA NÃO TEM HOJE, E ISSO VALE PRA TODOS OS TIPOS, URGÊNCIA INCLUSIVE/.test(SEM_COMENTARIO),
    "3. e está dito que a urgência não é exceção");
  ok(/a partir de amanhã/.test(SEM_COMENTARIO),
    "3b. a regra da urgência foi corrigida junto, senão ela promete hoje pra febre");
}

// ------------------------------------------------- 2. o assunto atravessa as quatro camadas
{
  ok(/enum: \["pagamento", "encaixe", "horario", "tipo", "valor", "fim_de_semana", "outro"\]/.test(CEREBRO),
    "4. a ferramenta aceita o assunto, na lista dos motivos");
  ok(/ctx\.escalarAssunto = OpcoesEscalonamento\.normalizarMotivo\(input\.assunto\);/.test(CEREBRO),
    "4b. assunto inventado pelo modelo cai em 'outro', que é o caminho sem poder nenhum");
  ok(/assunto: resultado\.escalarAssunto === "encaixe" \? "encaixe" : null,/.test(SERVER),
    "4c. o bot repassa pro alerta");
  ok(/if \(assunto === "encaixe"\) registro\.assunto = "encaixe";/.test(STORAGE),
    "4d. e o storage grava só esse valor, nunca o que vier");
}

// ------------------------------------------------- 3. o painel abre o horário, e ANTES
{
  ok(/corpo\.horaEncaixe/.test(PAINEL), "5. o painel aceita a hora que o Dr. Bruno digitou");
  ok(/\/\^\(\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d\$\/\.test\(corpo\.horaEncaixe\)/.test(PAINEL),
    "5b. validada: hora torta não abre horário nenhum");
  ok(/alerta\.assunto === "encaixe"/.test(PAINEL),
    "5c. e só num alerta de encaixe: a hora não vaza pra outro tipo de escalonamento");
  ok(/Storage\.adicionarHorarioExtra\(dia, horaEncaixe\)/.test(PAINEL), "5d. o horário é aberto na agenda");

  // As duas posições são procuradas DEPOIS do começo desta rota: "encaminharAoBot" aparece
  // antes no arquivo, em outra rota, e procurar do zero achava a errada (o teste passava com
  // a ordem invertida).
  const rota = PAINEL.indexOf('if (req.url === "/api/responder-escalada"');
  const posAbre = PAINEL.indexOf("Storage.adicionarHorarioExtra(dia, horaEncaixe)", rota);
  const posManda = PAINEL.indexOf("encaminharAoBot(\"/interno/resposta-do-doutor\"", rota);
  ok(posAbre > 0 && posManda > posAbre,
    "5e. e é aberto ANTES de a resposta ir pra Carla, senão ela consulta e não acha");

  ok(/const hojeLocal = \(\) => \{/.test(PAINEL) && /d\.getFullYear\(\)/.test(PAINEL),
    "5f. o dia de hoje é o local, não o de toISOString: depois das 21h o UTC já é amanhã");
  ok(!/horaEncaixe[\s\S]{0,200}toISOString/.test(PAINEL),
    "5f2. e o UTC não aparece perto do encaixe");
}

// ------------------------------------------------- 4. a tela
{
  ok(/al\.assunto === "encaixe"/.test(TELA), "6. a tela reconhece o alerta de encaixe");
  // Ancorado no ELEMENTO, e não no atributo solto: "data-encaixe-hora" também aparece no
  // seletor do JavaScript que lê o campo, então apagar o input passava no teste.
  ok(/<input type="time" class="encaixe-hora" data-encaixe-hora="\$\{escapeHtml\(al\.id\)\}"/.test(TELA),
    "6b. com um campo de horário de verdade na tela");
  ok(/data-encaixe="/.test(TELA), "6c. e o botão que autoriza");
  ok(/Não consigo encaixar hoje\./.test(TELA) && /Não consigo encaixar hoje nem amanhã\./.test(TELA),
    "6d. e DUAS recusas diferentes, porque elas levam a Carla a conversas diferentes");
  ok(/alert\("Escolha o horário do encaixe antes\."\)/.test(TELA),
    "6e. autorizar sem horário é impedido: abriria consulta em lugar nenhum");
  ok(/horaEncaixe \}\);/.test(TELA) || /resposta, horaEncaixe \}\)/.test(TELA),
    "6f. a hora vai junto da resposta");
  ok(/O horário já está aberto na agenda: consulte a agenda de hoje e ofereça esse horário\./.test(TELA),
    "6g. e o recado diz à Carla o que fazer, em vez de deixá-la adivinhar");
}

// ------------------------------------------------- 4b. o aviso no WhatsApp dele
{
  // O dono pediu "com avisos no meu whatsap tbm, igual os avisos de quando marca consulta".
  // O aviso de escalonamento já existia; o que faltava era ele dizer, no cabeçalho, que é
  // pra HOJE. É o que ele lê na notificação do celular sem abrir nada.
  ok(/tipo === "encaixe"\s*\n\s*\? "⏱️ Encaixe pra HOJE"/.test(SERVER),
    "4e. o aviso tem cabeçalho próprio: 'precisa de você' não diz que é pra hoje");
  ok(/resultado\.escalarAssunto === "encaixe" \? "encaixe" : "escalonamento"/.test(SERVER),
    "4f. e é disparado pelo assunto do escalonamento");
  ok(/Consigo encaixar hoje.{0,4} que o horário é aberto na agenda/.test(SERVER),
    "4g. e o rodapé diz o que fazer no painel, que ali não é Sim nem Não");
}

// ------------------------------------------------- 5. de ponta a ponta, na agenda de verdade
{
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "carla-encaixe-"));
  let storage;
  try {
    for (const nome of ["storage-node.js", "arquivo-atomico.js", "grade-teleconsulta.js"]) {
      fs.copyFileSync(path.join(__dirname, "..", nome), path.join(temp, nome));
    }
    fs.cpSync(path.join(__dirname, "..", "carla-app"), path.join(temp, "carla-app"), { recursive: true });
    storage = require(path.join(temp, "storage-node.js"));

    // Uma quinta-feira de manhã, que é dia de atendimento na grade do consultório.
    const agora = new Date(2026, 9, 1, 9, 0);
    const p2 = (n) => String(n).padStart(2, "0");
    const hoje = `${agora.getFullYear()}-${p2(agora.getMonth() + 1)}-${p2(agora.getDate())}`;

    eq(storage.slotsPossiveisComExtras(agora).filter((s) => s.date === hoje).length, 0,
      "7. antes do encaixe, a agenda de hoje está vazia pra Carla");

    storage.adicionarHorarioExtra(hoje, "15:00");
    const deHoje = storage.slotsPossiveisComExtras(agora).filter((s) => s.date === hoje);
    eq(deHoje.length, 1, "7b. autorizado o encaixe, existe exatamente um horário hoje");
    ok(deHoje[0].label.includes("15h"), "7c. e é o que ele abriu");
    eq(storage.extrasDisponiveis(agora, new Set(), { data: hoje }).length, 1,
      "7d. e ele aparece como LIVRE pra oferecer, que é o que a Carla precisa");

    // E a regra de hoje não voltou pela porta dos fundos: um extra de hoje que já passou,
    // ou que começa em menos de uma hora, continua fora.
    storage.adicionarHorarioExtra(hoje, "09:30");
    eq(storage.extrasDisponiveis(agora, new Set(), { data: hoje }).length, 1,
      "7e. mas um encaixe pra daqui a 30 minutos não vale: a antecedência mínima continua de pé");
  } finally {
    if (storage) storage._fecharBancoAgendamentosParaTeste();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

console.log(`encaixe-de-hoje: ${passou} passaram, ${erros.length} falharam`);
if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
