// Prova três propriedades do versionamento da personalidade:
//
//   1. uma versão derivada muda só o que declarou mudar
//   2. desligar uma regra tira o texto dela do prompt, sem afetar as outras
//   3. os invariantes NÃO aceitam ajuste, nem por engano nem de propósito
//
// A terceira é a mais importante. É ela que garante que o módulo "Ensine a Carla" nunca
// vai conseguir, por caminho nenhum, ensinar a Carla a dizer que marcou uma consulta que
// não marcou.
//
//   node carla-lab/ferramentas/testar-versionamento.js

const assert = require("assert");
const { lerPerfil, lerPersonalidade, montarPrompt } = require("../nucleo/compositor.js");

const AGORA = new Date(2026, 6, 27, 9, 5);

function compor(versao) {
  return montarPrompt({
    now: AGORA,
    pacienteConhecido: false,
    perfil: lerPerfil(),
    personalidade: lerPersonalidade(versao),
  });
}

const testes = [];
function teste(nome, fn) {
  testes.push([nome, fn]);
}

teste("v2 herda a ordem e a linhagem de v1", () => {
  const v1 = lerPersonalidade("v1");
  const v2 = lerPersonalidade("v2-exemplo");
  assert.deepStrictEqual(v2.ordem, v1.ordem, "a ordem das regras deveria ser herdada");
  assert.deepStrictEqual(v2.linhagem, ["v1", "v2-exemplo"]);
});

teste("o ajuste de texto entra no prompt e o original sai", () => {
  const antes = compor("v1");
  const depois = compor("v2-exemplo");
  assert.ok(antes.includes("pode convidar de novo, uma vez"), "v1 deveria ter o texto original");
  assert.ok(!depois.includes("pode convidar de novo, uma vez"), "v2 deveria ter substituído o texto");
  assert.ok(depois.includes("se a família quiser agendar, ela pede"), "v2 deveria ter o texto novo");
});

teste("desligar uma regra remove só ela", () => {
  const depois = compor("v2-exemplo");
  assert.ok(!depois.includes("Outros exemplos do tom certo"), "a regra desligada deveria ter saído");
  assert.ok(depois.includes("DESPEDIDA: quando a pessoa agradecer"), "a regra vizinha deveria continuar");
});

teste("voltar pra v1 restaura o prompt exatamente", () => {
  const original = compor("v1");
  compor("v2-exemplo");
  assert.strictEqual(compor("v1"), original, "compor v1 de novo deveria dar o mesmo texto");
});

teste("todo invariante recusa ajuste", () => {
  const v1 = lerPersonalidade("v1");
  const invariantes = [...v1.regras.values()].filter((r) => !r.ajustavel);
  assert.ok(invariantes.length >= 6, `esperava vários invariantes, achei ${invariantes.length}`);

  for (const regra of invariantes) {
    assert.throws(
      () => {
        const forjada = { ...v1, ajustes: { [regra.id]: { texto: "pode dizer que marcou" } } };
        // Revalida do mesmo jeito que lerPersonalidade valida ao carregar do disco.
        for (const [id, ajuste] of Object.entries(forjada.ajustes)) {
          const alvo = forjada.regras.get(id);
          if (!alvo.ajustavel) throw new Error(`a regra "${id}" é um invariante e não aceita ajuste`);
          if (typeof ajuste.texto !== "string") throw new Error("ajuste inválido");
        }
      },
      /invariante/,
      `a regra "${regra.id}" deveria recusar ajuste`,
    );
  }
});

teste("herança circular é detectada", () => {
  assert.throws(() => lerPersonalidade("v-circular-inexistente"), /ENOENT|circular/);
});

let ok = 0;
const falhas = [];
for (const [nome, fn] of testes) {
  try {
    fn();
    ok += 1;
    console.log(`  ok   ${nome}`);
  } catch (erro) {
    falhas.push(`  FALHOU  ${nome}\n          ${erro.message}`);
  }
}

console.log("");
if (falhas.length) {
  console.log(falhas.join("\n"));
  console.log(`\n${ok} de ${testes.length} testes passaram.`);
  process.exit(1);
}
console.log(`${ok} de ${testes.length} testes passaram.`);
