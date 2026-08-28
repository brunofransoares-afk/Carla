#!/usr/bin/env bash
set -Eeuo pipefail

# O conteúdo já chega redigido pelo preload log-seguro.js. Este módulo cuida do tamanho e
# da retenção dos arquivos do PM2. Valores podem ser substituídos no ambiente antes de rodar.
TAMANHO="${CARLA_LOG_ROTATE_SIZE:-10M}"
RETENCAO="${CARLA_LOG_RETAIN:-14}"

if ! pm2 describe pm2-logrotate >/dev/null 2>&1; then
  pm2 install pm2-logrotate
fi
pm2 set pm2-logrotate:max_size "$TAMANHO"
pm2 set pm2-logrotate:retain "$RETENCAO"
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'

echo "Rotação do PM2 configurada: tamanho=$TAMANHO, retenção=$RETENCAO arquivos."
