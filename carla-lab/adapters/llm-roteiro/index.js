// Adapter de LLM por roteiro: devolve respostas escritas de antemão, na ordem.
//
// Não é um brinquedo de teste. É o que torna possível verificar a máquina de conversa
// inteira sem chave de API, sem custo e sem variação entre execuções.
//
// Três coisas dependem disto:
//
//   1. A suíte de regressão hoje não consegue verificar se a Carla consultou a agenda
//      antes de oferecer horário. Com um roteiro, dá pra afirmar exatamente o que ela
//      deveria ter chamado, e a asserção passa a ser verificável.
//   2. O sandbox precisa ser barato e repetível. Uma rodada da suíte real custa dólares
//      e nunca dá exatamente o mesmo texto duas vezes.
//   3. Testar o que acontece quando o modelo erra (pede ferramenta que não existe,
//      devolve texto vazio, insiste em laço) é impossível com o modelo de verdade,
//      porque não dá pra pedir que ele erre.

function criar(roteiro = []) {
  let passo = 0;
  const chamadas = [];

  return {
    nome: "llm-roteiro",
    disponivel: () => true,
    chamadas, // o que o Core pediu, para o teste poder conferir

    gerar: async ({ system, mensagens, ferramentas }) => {
      chamadas.push({ system, mensagens: [...mensagens], ferramentas });

      if (passo >= roteiro.length) {
        throw new Error(
          `roteiro esgotado: o Core pediu ${passo + 1} respostas, o roteiro tem ${roteiro.length}. ` +
          `Ou o laço não está parando, ou falta um passo no roteiro.`,
        );
      }

      const resposta = roteiro[passo];
      passo += 1;

      return {
        texto: resposta.texto || "",
        ferramentasChamadas: (resposta.ferramentas || []).map((f, i) => ({
          id: f.id || `chamada-${passo}-${i}`,
          nome: f.nome,
          argumentos: f.argumentos || {},
        })),
        parouPara: (resposta.ferramentas || []).length ? "ferramenta" : "texto",
        cortadaPorLimite: !!resposta.cortadaPorLimite,
      };
    },

    _passosUsados: () => passo,
    _passosRestantes: () => roteiro.length - passo,
  };
}

module.exports = { criar };
