#!/usr/bin/env bash
#
# Recuperação do WhatsApp da Carla, num comando só.
#
# Escrito em 29/07/2026, durante uma queda de mais de 12 horas. Sintomas:
#   - conexão morreu sozinha às 19:02 de 28/07, sem ninguém mexer em nada
#   - laço de "Connection Failure" desde então, nunca "loggedOut"
#   - pareamento novo, com pasta de sessão limpa, fecha com código 405
#   - o WhatsApp no celular funciona normalmente
#
# O celular funcionando descarta banimento de conta. Sobra o Baileys estar defasado:
# a versão instalada é 7.0.0-rc13, uma candidata, e o WhatsApp muda o protocolo com
# frequência. Versão antiga passa a ser recusada, e o sintoma é exatamente esse.
#
# Este script atualiza o Baileys, refaz o pareamento e sobe o bot, guardando o caminho
# de volta em cada passo.
#
#   bash recuperar-whatsapp.sh 5519996859061
#
# Para desfazer a atualização, o script imprime o comando exato no fim.

set -uo pipefail

REPO="${CARLA_REPO:-/root/carla/carla-whatsapp-bot}"
NUMERO="${1:-}"
CARIMBO="$(date +%Y-%m-%d_%H%M)"

titulo() { echo; echo "=============================================="; echo "  $1"; echo "=============================================="; }
passo()  { echo; echo "[$1] $2"; }

if [ -z "$NUMERO" ]; then
  echo
  echo "Informe o número do WhatsApp, só dígitos, com país e DDD:"
  echo "  bash recuperar-whatsapp.sh 5519996859061"
  echo
  exit 1
fi

if [ ! -f "$REPO/package.json" ]; then
  echo "Não achei o repositório em $REPO"
  echo "Use: CARLA_REPO=/caminho bash recuperar-whatsapp.sh $NUMERO"
  exit 1
fi

cd "$REPO" || exit 1

titulo "RECUPERAÇÃO DO WHATSAPP DA CARLA"

# ---------------------------------------------------------------- 1. situação atual
passo 1 "Vendo a situação atual"

VERSAO_ANTES="$(node -p "require('@whiskeysockets/baileys/package.json').version" 2>/dev/null || echo "desconhecida")"
echo "     Baileys instalado: $VERSAO_ANTES"

# ---------------------------------------------------------------- 2. parar o bot
passo 2 "Parando o bot (ele não pode disputar a sessão)"
pm2 stop carla-bot > /dev/null 2>&1
echo "     parado"

# ---------------------------------------------------------------- 3. guardar a sessão
passo 3 "Guardando a sessão atual"
if [ -d "$REPO/data/auth" ] && [ -n "$(ls -A "$REPO/data/auth" 2>/dev/null)" ]; then
  mv "$REPO/data/auth" "$REPO/data/auth.antes-de-recuperar-$CARIMBO"
  echo "     movida para data/auth.antes-de-recuperar-$CARIMBO"
else
  echo "     já estava vazia ou movida, nada a fazer"
fi

# ---------------------------------------------------------------- 4. atualizar
passo 4 "Atualizando o Baileys"
cp package.json "/root/package.json.antes-de-recuperar-$CARIMBO" 2>/dev/null
cp package-lock.json "/root/package-lock.json.antes-de-recuperar-$CARIMBO" 2>/dev/null

npm install @whiskeysockets/baileys@latest --silent 2>&1 | tail -5

VERSAO_DEPOIS="$(node -p "require('@whiskeysockets/baileys/package.json').version" 2>/dev/null || echo "erro")"
echo "     antes:  $VERSAO_ANTES"
echo "     agora:  $VERSAO_DEPOIS"

if [ "$VERSAO_DEPOIS" = "erro" ]; then
  echo
  echo "A instalação falhou. Nada foi perdido: o bot está parado e a sessão guardada."
  echo "Para voltar o package.json:"
  echo "  cp /root/package.json.antes-de-recuperar-$CARIMBO $REPO/package.json && cd $REPO && npm install"
  exit 1
fi

if [ "$VERSAO_ANTES" = "$VERSAO_DEPOIS" ]; then
  echo
  echo "     A versão não mudou. Já era a mais recente, então o problema não é esse."
  echo "     O pareamento abaixo ainda vale a tentativa, mas se der 405 de novo é"
  echo "     restrição do WhatsApp, e o caminho é esperar algumas horas."
fi

# ---------------------------------------------------------------- 5. parear
passo 5 "Pareando"
echo "     Vai aparecer um código de 8 caracteres."
echo "     No celular: WhatsApp > Configurações > Aparelhos conectados"
echo "     > Conectar dispositivo > Conectar com número de telefone"
echo

if [ ! -f /root/parear-carla.js ]; then
  echo "     Baixando a ferramenta de pareamento..."
  curl -fsSL "https://raw.githubusercontent.com/brunofransoares-afk/Carla/carla/lab/carla-lab/operacao/parear-whatsapp.js" \
    -o /root/parear-carla.js 2>/dev/null
fi

CARLA_REPO="$REPO" node /root/parear-carla.js "$NUMERO"
PAREOU=$?

if [ "$PAREOU" -ne 0 ]; then
  titulo "NÃO PAREOU"
  echo "  O WhatsApp recusou de novo."
  echo
  echo "  Se o código foi 405 outra vez, com o Baileys já atualizado, então é"
  echo "  restrição do WhatsApp ao número ou ao IP do servidor, e não versão."
  echo "  Nesse caso: NÃO tente de novo agora. Cada recusa reforça a restrição."
  echo "  Espere de 4 a 6 horas e rode este script uma única vez."
  echo
  echo "  Para voltar a versão anterior do Baileys:"
  echo "    cp /root/package.json.antes-de-recuperar-$CARIMBO $REPO/package.json"
  echo "    cd $REPO && npm install"
  echo
  exit 1
fi

# ---------------------------------------------------------------- 6. subir e conferir
passo 6 "Subindo o bot e conferindo"
pm2 start carla-bot > /dev/null 2>&1

echo "     esperando a conexão (até 60 segundos)..."
CONECTOU=0
for _ in $(seq 1 12); do
  sleep 5
  if pm2 logs carla-bot --lines 30 --nostream 2>/dev/null | grep -q "Carla está conectada"; then
    CONECTOU=1
    break
  fi
done

if [ "$CONECTOU" = 1 ]; then
  titulo "A CARLA VOLTOU"
  echo "  Conectada e respondendo no WhatsApp."
  echo
  echo "  Baileys: $VERSAO_ANTES  ->  $VERSAO_DEPOIS"
  echo "  Sessão antiga guardada em data/auth.antes-de-recuperar-$CARIMBO"
  echo
  echo "  Manda uma mensagem de outro número pra confirmar de verdade."
  echo
else
  titulo "PAREOU, MAS NÃO CONECTOU"
  echo "  O pareamento deu certo, mas o bot não confirmou a conexão em 60s."
  echo "  Pode ser só demora. Veja o log:"
  echo "    pm2 logs carla-bot --lines 30"
  echo
fi
