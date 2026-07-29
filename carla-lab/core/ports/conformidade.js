// Verifica se um adapter cumpre uma porta.
//
// Checagem de forma, não de comportamento: os métodos existem, são funções, e aceitam a
// quantidade de argumentos declarada. Comportamento é verificado pelos testes de cada
// adapter, porque só ali dá pra dizer se "reservar duas vezes falha na segunda".
//
// A aridade é conferida com folga: JavaScript não conta argumentos com valor padrão nem
// resto, então `function f(a, b = 1)` tem length 1. Por isso a regra é "aceita pelo menos
// o mínimo necessário", nunca igualdade exata, que daria falso negativo em código correto.

const { PORTAS } = require("./index.js");

function verificar(adapter, nomeDaPorta) {
  const porta = PORTAS[nomeDaPorta];
  if (!porta) throw new Error(`porta desconhecida: ${nomeDaPorta}`);

  const problemas = [];
  for (const [metodo, spec] of Object.entries(porta.metodos)) {
    const fn = adapter[metodo];
    if (fn === undefined) {
      problemas.push(`${nomeDaPorta}.${metodo} não existe`);
      continue;
    }
    if (typeof fn !== "function") {
      problemas.push(`${nomeDaPorta}.${metodo} existe mas não é função (é ${typeof fn})`);
      continue;
    }
    // Argumentos com valor padrão não entram em fn.length, então só acusamos quando o
    // adapter claramente declara menos do que o contrato exige sem padrão nenhum.
    if (fn.length > spec.aridade) {
      problemas.push(
        `${nomeDaPorta}.${metodo} exige ${fn.length} argumentos, mas o contrato prevê ${spec.aridade} ${spec.argumentos || ""}`,
      );
    }
  }
  return problemas;
}

function verificarVarias(adapter, nomesDePortas) {
  return nomesDePortas.flatMap((nome) => verificar(adapter, nome));
}

// Lista o que uma porta exige, para quem for escrever um adapter novo.
function descrever(nomeDaPorta) {
  const porta = PORTAS[nomeDaPorta];
  const linhas = [`${porta.nome}: ${porta.descricao}`];
  for (const [metodo, spec] of Object.entries(porta.metodos)) {
    linhas.push(`  ${metodo}${spec.argumentos || "()"} -> ${spec.devolve}`);
    linhas.push(`      ${spec.contrato}`);
  }
  return linhas.join("\n");
}

module.exports = { verificar, verificarVarias, descrever };
