// Adapter de LLM sobre a Claude.
//
// Faz UMA ida ao modelo e traduz nos dois sentidos: recebe mensagens no formato neutro
// da porta e devolve resposta no formato neutro. O laço (executar ferramenta, devolver
// resultado, pedir de novo) NÃO está aqui: é do Core, porque é comportamento igual em
// qualquer provedor.
//
// Essa tradução é o que impede o formato da Anthropic de vazar pro miolo. Sem ela,
// trocar de modelo um dia significaria mexer no Core.

const MODELO_PADRAO = "claude-sonnet-5";
const MAX_TOKENS = 1500;

let Anthropic = null;
let cliente = null;

function obterCliente() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!cliente) {
    // Carregado sob demanda: dá pra inspecionar e conferir a porta sem a biblioteca.
    Anthropic = Anthropic || require("@anthropic-ai/sdk");
    cliente = new Anthropic();
  }
  return cliente;
}

// neutro -> Anthropic
function paraAnthropic(mensagens) {
  return mensagens.map((m) => {
    if (m.de === "familia") return { role: "user", content: m.texto };
    if (m.de === "ferramenta") {
      return {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.id, content: JSON.stringify(m.resultado) }],
      };
    }
    // Carla: pode ter texto, chamadas de ferramenta, ou os dois na mesma resposta.
    const blocos = [];
    if (m.texto) blocos.push({ type: "text", text: m.texto });
    for (const f of m.ferramentas || []) {
      blocos.push({ type: "tool_use", id: f.id, name: f.nome, input: f.argumentos });
    }
    return { role: "assistant", content: blocos.length ? blocos : m.texto || "" };
  });
}

// Anthropic -> neutro
function paraNeutro(resposta) {
  const texto = resposta.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const ferramentasChamadas = resposta.content
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ id: b.id, nome: b.name, argumentos: b.input }));

  return {
    texto,
    ferramentasChamadas,
    parouPara: resposta.stop_reason === "tool_use" ? "ferramenta" : "texto",
    // Sinalizado, não engolido: resposta cortada é bug de configuração, não de conversa.
    cortadaPorLimite: resposta.stop_reason === "max_tokens",
  };
}

module.exports = {
  nome: "llm-anthropic",
  disponivel: () => !!process.env.ANTHROPIC_API_KEY,

  gerar: async ({ system, mensagens, ferramentas, modelo = MODELO_PADRAO }) => {
    const api = obterCliente();
    if (!api) throw new Error("ANTHROPIC_API_KEY não está definida");
    const resposta = await api.messages.create({
      model: modelo,
      max_tokens: MAX_TOKENS,
      system,
      tools: ferramentas,
      messages: paraAnthropic(mensagens),
    });
    return paraNeutro(resposta);
  },

  // Exportados para teste: dá pra verificar a tradução sem gastar uma chamada de API.
  _paraAnthropic: paraAnthropic,
  _paraNeutro: paraNeutro,
};
