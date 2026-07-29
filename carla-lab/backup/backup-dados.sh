#!/usr/bin/env bash
#
# Backup dos dados da Carla (agendamentos, contatos, alertas, conversas).
#
# Hoje esses arquivos existem em um lugar só, sem cópia nenhuma: se o disco do VPS
# morrer, a agenda inteira do consultório vai junto. Este script resolve isso.
#
# O que ele NÃO faz de propósito: mexer no bot. Ele só lê a pasta data/ e escreve o
# pacote em outro lugar. Pode rodar com a Carla no ar, sem parar nada.
#
# Instalação no servidor (uma vez):
#   chmod +x /root/carla/carla-whatsapp-bot/carla-lab/backup/backup-dados.sh
#   crontab -e
#   0 3 * * *  /root/carla/carla-whatsapp-bot/carla-lab/backup/backup-dados.sh >> /root/carla/carla-whatsapp-bot/logs/backup.log 2>&1
#
# Restauração: veja README.md nesta mesma pasta.

set -euo pipefail

ORIGEM="${CARLA_DATA_DIR:-/root/carla/carla-whatsapp-bot/data}"
DESTINO="${CARLA_BACKUP_DIR:-/root/backups/carla}"
MANTER_DIAS="${CARLA_BACKUP_MANTER:-30}"

carimbo="$(date +%Y-%m-%d_%H%M)"
pacote="${DESTINO}/carla-dados-${carimbo}.tar.gz"

if [ ! -d "$ORIGEM" ]; then
  echo "[backup] ERRO: pasta de dados não encontrada: $ORIGEM"
  exit 1
fi

mkdir -p "$DESTINO"

# Escreve primeiro num arquivo temporário: um backup interrompido no meio nunca
# aparece na pasta com nome de backup bom.
tmp="${pacote}.parcial"
tar -czf "$tmp" -C "$(dirname "$ORIGEM")" "$(basename "$ORIGEM")"

# Um backup que ninguém testou não é um backup. Confere que o pacote abre e que os
# arquivos que mais importam estão dentro antes de aceitá-lo.
if ! tar -tzf "$tmp" > /dev/null 2>&1; then
  echo "[backup] ERRO: pacote corrompido, descartado"
  rm -f "$tmp"
  exit 1
fi

listagem="$(tar -tzf "$tmp")"

# A conferência usa casamento de padrão do próprio bash, NUNCA "echo | grep -q".
# Com pipefail ligado, grep -q sai na primeira ocorrência, o echo leva SIGPIPE com o
# resto da listagem por escrever, e a checagem acusa falta de um arquivo que está lá.
# Só acontece quando a listagem passa do buffer de 64 KB do pipe, ou seja, exatamente
# em produção e nunca num teste pequeno.
contem() {
  case "$listagem" in *"$1"*) return 0 ;; *) return 1 ;; esac
}

# Sem estes três, o backup não serve para restaurar o consultório.
ESSENCIAIS="agendamentos.json contatos-whatsapp.json sessoes.json"
faltando=0
for esperado in $ESSENCIAIS; do
  if contem "$esperado"; then
    echo "[backup]   ok      $esperado"
  else
    echo "[backup]   FALTOU  $esperado"
    faltando=1
  fi
done

# A pasta auth/ é a sessão do WhatsApp. Guardá-la faz a restauração dispensar ler o QR
# Code de novo, e é também o motivo de o pacote ter mais de mil arquivos.
if contem "auth/"; then
  echo "[backup]   ok      auth/ (sessão do WhatsApp)"
else
  echo "[backup]   AVISO   auth/ ausente: restaurar vai exigir ler o QR Code de novo"
fi

mv "$tmp" "$pacote"
tamanho="$(du -h "$pacote" | cut -f1)"
total="$(printf '%s\n' "$listagem" | wc -l)"
sessao="$(printf '%s\n' "$listagem" | grep -c '/auth/' || true)"
dados=$((total - sessao))
echo "[backup] $(date '+%Y-%m-%d %H:%M') ok: $pacote"
echo "[backup] $tamanho · $dados arquivo(s) de dados + $sessao de sessão do WhatsApp"

# Rotação: remove pacotes mais velhos que a janela, sempre preservando o mais recente
# mesmo que ele já tenha passado da idade (melhor um backup velho do que nenhum).
recentes="$(ls -1t "${DESTINO}"/carla-dados-*.tar.gz 2>/dev/null | head -1 || true)"
find "$DESTINO" -name 'carla-dados-*.tar.gz' -mtime "+${MANTER_DIAS}" ! -path "$recentes" -delete 2>/dev/null || true

total="$(ls -1 "${DESTINO}"/carla-dados-*.tar.gz 2>/dev/null | wc -l)"
echo "[backup] $total pacote(s) guardado(s), janela de ${MANTER_DIAS} dias"

exit "$faltando"
