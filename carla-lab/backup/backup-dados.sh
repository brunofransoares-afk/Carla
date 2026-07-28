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
#   chmod +x /root/carla/carla-lab/backup/backup-dados.sh
#   crontab -e
#   0 3 * * *  /root/carla/carla-lab/backup/backup-dados.sh >> /root/carla/logs/backup.log 2>&1
#
# Restauração: veja README.md nesta mesma pasta.

set -euo pipefail

ORIGEM="${CARLA_DATA_DIR:-/root/carla/data}"
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
faltando=0
for esperado in agendamentos contatos; do
  if ! echo "$listagem" | grep -q "$esperado"; then
    echo "[backup] AVISO: não encontrei nenhum arquivo de '$esperado' no pacote"
    faltando=1
  fi
done

mv "$tmp" "$pacote"
tamanho="$(du -h "$pacote" | cut -f1)"
arquivos="$(echo "$listagem" | wc -l)"
echo "[backup] $(date '+%Y-%m-%d %H:%M') ok: $pacote ($tamanho, $arquivos arquivos)"

# Rotação: remove pacotes mais velhos que a janela, sempre preservando o mais recente
# mesmo que ele já tenha passado da idade (melhor um backup velho do que nenhum).
recentes="$(ls -1t "${DESTINO}"/carla-dados-*.tar.gz 2>/dev/null | head -1 || true)"
find "$DESTINO" -name 'carla-dados-*.tar.gz' -mtime "+${MANTER_DIAS}" ! -path "$recentes" -delete 2>/dev/null || true

total="$(ls -1 "${DESTINO}"/carla-dados-*.tar.gz 2>/dev/null | wc -l)"
echo "[backup] $total pacote(s) guardado(s), janela de ${MANTER_DIAS} dias"

exit "$faltando"
