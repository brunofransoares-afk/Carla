#!/usr/bin/env bash
# Roda todas as verificações do laboratório de uma vez.
#   bash carla-lab/core/ports/rodar-tudo.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."

falhou=0
executar() {
  local nome="$1"; shift
  local saida
  if saida="$("$@" 2>&1)"; then
    echo "  ok      $nome: $(echo "$saida" | tail -1)"
  else
    echo "  FALHOU  $nome"
    echo "$saida" | tail -5 | sed 's/^/          /'
    falhou=1
  fi
}

echo
executar "prompt"              node carla-lab/ferramentas/verificar-equivalencia.js
executar "versionamento"       node carla-lab/ferramentas/testar-versionamento.js
executar "corpus de regressão" node carla-lab/regressao/verificar-cobertura.js
executar "emergência"          node carla-lab/emergencia/testar.js
executar "portas"              node carla-lab/core/ports/testar.js
executar "LLM e canal"         node carla-lab/core/ports/testar-llm-e-canal.js
executar "adapters idênticos"  node carla-lab/core/ports/testar-equivalencia-adapters.js
echo
[ "$falhou" = 0 ] && echo "Tudo verde." || echo "Há falhas acima."
exit "$falhou"
