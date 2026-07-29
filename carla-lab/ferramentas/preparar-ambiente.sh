#!/usr/bin/env bash
#
# Deixa o repositório rodável fora do servidor.
#
# O código de produção carrega carla-app/ como pasta IRMÃ do repositório
# (require(__dirname, "..", "carla-app", "js", ...)). No servidor isso existe; em
# qualquer outro lugar, não, e por isso nem storage-node.js nem cerebro-ia.js
# conseguiam ser carregados fora do VPS.
#
# Como o config.js e o agenda.js passaram a ser versionados (carla-lab/vps/arquivos/),
# dá pra montar essa pasta irmã a partir deles. Isso é o que torna a Fase 2 testável:
# sem conseguir carregar os módulos, não há como verificar que uma porta nova se
# comporta igual ao código que ela substitui.
#
# Não toca em nada dentro do repositório e não roda no servidor de produção, onde a
# pasta de verdade já existe.
#
#   bash carla-lab/ferramentas/preparar-ambiente.sh

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IRMA="$(dirname "$REPO")/carla-app"
FONTE="$REPO/carla-lab/vps/arquivos"

if [ -e "$IRMA" ] && [ ! -L "$IRMA" ]; then
  echo "[ambiente] $IRMA já existe e não é um link. Nada a fazer."
  echo "[ambiente] (é o caso do servidor de produção, onde a pasta é a de verdade)"
  exit 0
fi

mkdir -p "$IRMA/js"
for arquivo in config.js agenda.js; do
  if [ ! -f "$FONTE/$arquivo" ]; then
    echo "[ambiente] ERRO: $FONTE/$arquivo não existe"
    exit 1
  fi
  ln -sf "$FONTE/$arquivo" "$IRMA/js/$arquivo"
  echo "[ambiente] $IRMA/js/$arquivo -> carla-lab/vps/arquivos/$arquivo"
done

node -e "
  require('$IRMA/js/config.js');
  const A = require('$IRMA/js/agenda.js');
  const slots = A.gerarSlotsPossiveis(new Date(2026, 6, 27, 7, 0));
  console.log('[ambiente] ok: config e agenda carregam, ' + slots.length + ' horários no horizonte');
"

echo "[ambiente] pronto. storage-node.js já pode ser carregado fora do servidor."
