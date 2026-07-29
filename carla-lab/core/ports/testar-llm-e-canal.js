// Testes das portas de LLM e Canal.
//
// A tradução entre o formato neutro e o da Anthropic é verificável sem chave de API e sem
// custo, porque é função pura. Vale testar com cuidado: é ela que impede o formato de um
// provedor de vazar pro Core, e um erro aqui só apareceria numa conversa real.
//
//   node carla-lab/core/ports/testar-llm-e-canal.js

const assert = require("assert");
const anthropic = require("../../adapters/llm-anthropic/index.js");
const roteiro = require("../../adapters/llm-roteiro/index.js");
const canal = require("../../adapters/canal-memoria/index.js");

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

// ------------------------------------------------- tradução neutro -> Anthropic

teste("mensagem da família vira turno do usuário", () => {
  const saida = anthropic._paraAnthropic([{ de: "familia", texto: "oi" }]);
  assert.deepStrictEqual(saida, [{ role: "user", content: "oi" }]);
});

teste("resposta só de texto da Carla vira turno do assistente", () => {
  const saida = anthropic._paraAnthropic([{ de: "carla", texto: "Bom dia! 😊" }]);
  assert.strictEqual(saida[0].role, "assistant");
  assert.deepStrictEqual(saida[0].content, [{ type: "text", text: "Bom dia! 😊" }]);
});

teste("texto E ferramenta na mesma resposta preservam os dois", () => {
  // Este caso é real e está documentado no código de produção: a Claude às vezes escreve
  // algo (informar o valor) na MESMA resposta em que já chama uma ferramenta. Perder o
  // texto aqui significaria a família nunca receber aquela frase.
  const saida = anthropic._paraAnthropic([
    {
      de: "carla",
      texto: "O valor é R$ 550.",
      ferramentas: [{ id: "t1", nome: "consultar_horarios", argumentos: { urgente: true } }],
    },
  ]);
  assert.strictEqual(saida[0].content.length, 2, "texto e chamada precisam sobreviver juntos");
  assert.strictEqual(saida[0].content[0].type, "text");
  assert.strictEqual(saida[0].content[1].type, "tool_use");
  assert.deepStrictEqual(saida[0].content[1].input, { urgente: true });
});

teste("resultado de ferramenta vira tool_result ligado pelo id", () => {
  const saida = anthropic._paraAnthropic([
    { de: "ferramenta", id: "t1", resultado: { horarios: ["segunda 8h"] } },
  ]);
  assert.strictEqual(saida[0].role, "user");
  assert.strictEqual(saida[0].content[0].type, "tool_result");
  assert.strictEqual(saida[0].content[0].tool_use_id, "t1");
  assert.strictEqual(saida[0].content[0].content, '{"horarios":["segunda 8h"]}');
});

teste("uma conversa inteira traduz na ordem certa", () => {
  const saida = anthropic._paraAnthropic([
    { de: "familia", texto: "quero marcar" },
    { de: "carla", ferramentas: [{ id: "t1", nome: "consultar_horarios", argumentos: {} }] },
    { de: "ferramenta", id: "t1", resultado: { slots: [] } },
    { de: "carla", texto: "Tenho segunda às 8h." },
  ]);
  assert.deepStrictEqual(
    saida.map((m) => m.role),
    ["user", "assistant", "user", "assistant"],
  );
});

// ------------------------------------------------- tradução Anthropic -> neutro

teste("resposta de texto puro vira parouPara texto", () => {
  const r = anthropic._paraNeutro({
    stop_reason: "end_turn",
    content: [{ type: "text", text: "  Bom dia!  " }],
  });
  assert.strictEqual(r.texto, "Bom dia!", "espaços das pontas são aparados");
  assert.strictEqual(r.parouPara, "texto");
  assert.deepStrictEqual(r.ferramentasChamadas, []);
});

teste("pedido de ferramenta vira parouPara ferramenta, com argumentos", () => {
  const r = anthropic._paraNeutro({
    stop_reason: "tool_use",
    content: [
      { type: "text", text: "Deixa eu ver" },
      { type: "tool_use", id: "t9", name: "consultar_horarios", input: { periodo: "manha" } },
    ],
  });
  assert.strictEqual(r.parouPara, "ferramenta");
  assert.strictEqual(r.texto, "Deixa eu ver", "o texto do mesmo turno não pode se perder");
  assert.deepStrictEqual(r.ferramentasChamadas, [
    { id: "t9", nome: "consultar_horarios", argumentos: { periodo: "manha" } },
  ]);
});

teste("duas ferramentas no mesmo turno viram duas chamadas", () => {
  // Acontece de verdade quando a família quer marcar para dois filhos.
  const r = anthropic._paraNeutro({
    stop_reason: "tool_use",
    content: [
      { type: "tool_use", id: "a", name: "confirmar_agendamento", input: { slotId: "1" } },
      { type: "tool_use", id: "b", name: "confirmar_agendamento", input: { slotId: "2" } },
    ],
  });
  assert.strictEqual(r.ferramentasChamadas.length, 2);
});

teste("resposta cortada por limite é sinalizada, não engolida", () => {
  const r = anthropic._paraNeutro({ stop_reason: "max_tokens", content: [{ type: "text", text: "..." }] });
  assert.strictEqual(r.cortadaPorLimite, true, "cortar por limite é bug de configuração, precisa aparecer");
});

teste("ida e volta preserva a conversa", () => {
  const original = [
    { de: "familia", texto: "quanto custa?" },
    { de: "carla", texto: "R$ 550.", ferramentas: [{ id: "t1", nome: "consultar_horarios", argumentos: {} }] },
  ];
  const emAnthropic = anthropic._paraAnthropic(original);
  const devolta = anthropic._paraNeutro({ stop_reason: "tool_use", content: emAnthropic[1].content });
  assert.strictEqual(devolta.texto, "R$ 550.");
  assert.deepStrictEqual(devolta.ferramentasChamadas, [
    { id: "t1", nome: "consultar_horarios", argumentos: {} },
  ]);
});

// ------------------------------------------------- adapter de roteiro

teste("roteiro devolve as respostas na ordem", async () => {
  const llm = roteiro.criar([
    { texto: "", ferramentas: [{ nome: "consultar_horarios", argumentos: { urgente: true } }] },
    { texto: "Tenho segunda às 8h." },
  ]);
  const primeira = await llm.gerar({ system: "s", mensagens: [], ferramentas: [] });
  assert.strictEqual(primeira.parouPara, "ferramenta");
  assert.strictEqual(primeira.ferramentasChamadas[0].nome, "consultar_horarios");

  const segunda = await llm.gerar({ system: "s", mensagens: [], ferramentas: [] });
  assert.strictEqual(segunda.parouPara, "texto");
  assert.strictEqual(segunda.texto, "Tenho segunda às 8h.");
});

teste("roteiro registra o que o Core pediu", async () => {
  const llm = roteiro.criar([{ texto: "oi" }]);
  await llm.gerar({ system: "PROMPT", mensagens: [{ de: "familia", texto: "oi" }], ferramentas: ["x"] });
  assert.strictEqual(llm.chamadas.length, 1);
  assert.strictEqual(llm.chamadas[0].system, "PROMPT", "dá pra afirmar qual prompt foi usado");
  assert.strictEqual(llm.chamadas[0].mensagens[0].texto, "oi");
});

teste("roteiro esgotado acusa laço que não para", async () => {
  const llm = roteiro.criar([{ texto: "uma só" }]);
  await llm.gerar({ system: "s", mensagens: [], ferramentas: [] });
  await assert.rejects(
    () => llm.gerar({ system: "s", mensagens: [], ferramentas: [] }),
    /roteiro esgotado/,
    "é assim que um laço infinito no Core apareceria como falha de teste, não como fatura",
  );
});

teste("roteiro gera ids de chamada quando não são informados", async () => {
  const llm = roteiro.criar([{ ferramentas: [{ nome: "escalar_humano" }, { nome: "consultar_horarios" }] }]);
  const r = await llm.gerar({ system: "s", mensagens: [], ferramentas: [] });
  const ids = r.ferramentasChamadas.map((f) => f.id);
  assert.strictEqual(new Set(ids).size, 2, "ids precisam ser únicos, senão o resultado volta pro lugar errado");
});

// ------------------------------------------------- canal em memória

teste("canal guarda o que seria enviado, sem enviar nada", async () => {
  const c = canal.criar();
  await c.enviarTexto("+5519999", "Bom dia!");
  assert.strictEqual(c.enviadas.length, 1);
  assert.deepStrictEqual(c._ultimaEnviada(), { telefone: "+5519999", texto: "Bom dia!" });
});

teste("canal entrega mensagem recebida a quem se registrou", async () => {
  const c = canal.criar();
  const recebidas = [];
  c.aoReceber((m) => recebidas.push(m));
  c._receber({ telefone: "+5519999", texto: "oi", id: "m1" });
  assert.strictEqual(recebidas[0].texto, "oi");
});

teste("canal reclama se ninguém registrou aoReceber", () => {
  const c = canal.criar();
  assert.throws(() => c._receber({ texto: "oi" }), /aoReceber/);
});

teste("conectar é idempotente", async () => {
  const c = canal.criar();
  await c.conectar();
  await c.conectar();
  assert.strictEqual(c._estaConectado(), true);
});

// ------------------------------------------------- execução

(async () => {
  let ok = 0;
  const falhas = [];
  for (const [nome, fn] of testes) {
    try {
      await fn();
      ok += 1;
      console.log(`  ok   ${nome}`);
    } catch (erro) {
      falhas.push(`  FALHOU  ${nome}\n          ${erro.message.split("\n")[0]}`);
    }
  }
  console.log("");
  if (falhas.length) {
    console.log(falhas.join("\n"));
    console.log(`\n${ok} de ${testes.length} testes passaram.`);
    process.exit(1);
  }
  console.log(`${ok} de ${testes.length} testes passaram.`);
})();
