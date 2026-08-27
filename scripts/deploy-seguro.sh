#!/usr/bin/env bash
set -Eeuo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK="${CARLA_DEPLOY_LOCK:-/tmp/carla-deploy.lock}"
TEMPORARIO=""

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "Outro deploy da Carla ainda está em andamento; esta execução encerrou sem alterar nada."
  exit 0
fi

cd "$RAIZ"

node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<5)){console.error("Node 22.5+ é obrigatório."); process.exit(1)}'

estado_pm2() {
  local nome="$1"
  pm2 jlist 2>/dev/null | node -e '
    let s=""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => {
      try { const a=JSON.parse(s).find(x => x.name === process.argv[1]);
        process.stdout.write(a?.pm2_env?.status === "online" ? "online" : "parado");
      } catch { process.stdout.write("parado"); }
    });' "$nome"
}

reiniciar_se_estava_online() {
  local nome="$1" estado="$2"
  if [[ "$estado" == "online" ]]; then
    pm2 startOrReload ecosystem.config.js --only "$nome" --update-env
  fi
}

saude_painel() {
  node --env-file=.env -e '
    const http=require("http");
    const senha=process.env.PAINEL_SENHA;
    if (!senha) process.exit(2);
    const req=http.get({host:"127.0.0.1",port:3355,path:"/api/status",
      headers:{Authorization:"Basic "+Buffer.from(":"+senha).toString("base64")}}, res => {
      let b=""; res.on("data", c => b += c); res.on("end", () => {
        try { JSON.parse(b); process.exit(res.statusCode === 200 ? 0 : 1); } catch { process.exit(1); }
      });
    });
    req.setTimeout(3000, () => req.destroy()); req.on("error", () => process.exit(1));'
}

aguardar_saude() {
  local tentativa
  for tentativa in {1..20}; do
    if saude_painel; then return 0; fi
    sleep 1
  done
  return 1
}

limpar_temporario() {
  if [[ -n "$TEMPORARIO" && -d "$TEMPORARIO" ]]; then rm -rf -- "$TEMPORARIO"; fi
}
trap limpar_temporario EXIT

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Deploy recusado: a cópia da VPS tem alterações locais. Resolva-as antes de atualizar."
  exit 1
fi

git fetch --prune origin main
ANTERIOR="$(git rev-parse HEAD)"
ALVO="$(git rev-parse origin/main)"
if [[ "$ANTERIOR" == "$ALVO" ]]; then exit 0; fi
if ! git merge-base --is-ancestor "$ANTERIOR" "$ALVO"; then
  echo "Deploy recusado: origin/main não é avanço direto da versão atual."
  exit 1
fi

BOT_ANTES="$(estado_pm2 carla-bot)"
PAINEL_ANTES="$(estado_pm2 carla-painel)"

# Valida exatamente o commit novo numa pasta descartável, antes de modificar a cópia ativa.
TEMPORARIO="$(mktemp -d)"
git archive "$ALVO" | tar -x -C "$TEMPORARIO"
(
  cd "$TEMPORARIO"
  npm ci --omit=dev
  npm run check
)

rollback() {
  local motivo="$1"
  echo "Falha após aplicar a versão nova: $motivo. Voltando para $ANTERIOR."
  git reset --hard "$ANTERIOR"
  npm ci --omit=dev
  reiniciar_se_estava_online carla-painel "$PAINEL_ANTES"
  reiniciar_se_estava_online carla-bot "$BOT_ANTES"
  exit 1
}

git merge --ff-only "$ALVO"
npm ci --omit=dev || rollback "npm ci"

# A versão anterior continua disponível no Git, mas dados de pacientes não. O backup é
# feito depois de validar o código novo e antes de reiniciar qualquer processo.
npm run backup || rollback "backup dos dados"

# Preserva o estado operacional. Em especial, um bot desligado pelo painel continua desligado.
reiniciar_se_estava_online carla-painel "$PAINEL_ANTES" || rollback "restart do painel"
reiniciar_se_estava_online carla-bot "$BOT_ANTES" || rollback "restart do bot"

if [[ "$PAINEL_ANTES" == "online" ]] && ! aguardar_saude; then
  rollback "health check do painel"
fi
if [[ "$BOT_ANTES" == "online" && "$(estado_pm2 carla-bot)" != "online" ]]; then
  rollback "health check do bot"
fi

pm2 save
echo "Deploy concluído: $ANTERIOR -> $ALVO (bot antes: $BOT_ANTES; bot depois: $(estado_pm2 carla-bot))."
