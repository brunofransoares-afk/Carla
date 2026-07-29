# Arquivos que existem só no VPS

Este é o item de maior risco do sistema hoje, e o único da Fase 0 que **não pode ser
resolvido daqui**: os arquivos estão numa máquina à qual esta sessão não tem acesso.

## O que está fora do Git

```
/root/carla/carla-app/js/config.js    ← grade de horários, duração, endereço, palavras de emergência
/root/carla/carla-app/js/agenda.js    ← toda a lógica de slots e disponibilidade
```

Os dois são carregados por `server.js`, `storage-node.js` e `cerebro-ia.js`. Sem eles a
Carla **não sobe**. E eles não estão versionados: existem em uma cópia, num disco, sem
histórico e sem backup. Se esse arquivo for perdido ou editado errado, não há de onde
voltar, e não há como saber o que mudou.

Não é um caso do `.gitignore`: `data/`, `.env` e `google-credenciais.json` estão fora do
Git de propósito, porque são segredo e dado de paciente. `carla-app/` ficou de fora por
acidente estrutural. É código de regra de negócio, e código de regra de negócio pertence
ao repositório.

## Como versionar

**NUNCA troque o branch dentro de `/root/carla/carla-whatsapp-bot`.** Essa é a pasta de onde o PM2 roda a
Carla de verdade, e o `auto-deploy.sh` espera encontrá-la em `main`. Deixar o checkout de
produção apontando para outro branch é uma armadilha: qualquer push futuro naquele branch
passaria a cair na pasta de produção.

A pasta de produção é só de leitura neste procedimento.

### Passo 1, no VPS: conferir se há segredo

O repositório `Carla` é **público**. Antes de qualquer coisa:

```bash
grep -niE 'key|token|senha|password|secret|credential|@gmail|https://' /root/carla/carla-app/js/config.js /root/carla/carla-app/js/agenda.js
```

Se aparecer alguma linha com chave, token ou senha, **pare** e avise antes de continuar.

### Passo 2, no VPS: mostrar o conteúdo

```bash
wc -l /root/carla/carla-app/js/config.js /root/carla/carla-app/js/agenda.js
cat /root/carla/carla-app/js/config.js
cat /root/carla/carla-app/js/agenda.js
```

O conteúdo é copiado e commitado a partir daí, sem rodar nenhum comando de Git no
servidor. Isso é `cat`: leitura pura, nada é alterado, a Carla nem percebe.

### Alternativa, se preferir commitar do servidor

Use um **clone separado**, nunca a pasta de produção:

```bash
git clone /root/carla/carla-whatsapp-bot /root/carla-lab-tmp
cd /root/carla-lab-tmp
git remote set-url origin <url-do-github>
git fetch origin carla/lab && git checkout carla/lab

mkdir -p carla-lab/vps/arquivos
cp /root/carla/carla-app/js/config.js carla-lab/vps/arquivos/
cp /root/carla/carla-app/js/agenda.js carla-lab/vps/arquivos/

git add carla-lab/vps/arquivos
git commit -m "Versiona config.js e agenda.js, que so existiam no VPS"
git push origin carla/lab

cd / && rm -rf /root/carla-lab-tmp
```

Em qualquer um dos caminhos, `/root/carla/carla-whatsapp-bot` continua em `main`, intocada.

## O contrato que esses arquivos precisam cumprir

Levantado lendo todos os usos no código de produção. Serve para duas coisas: conferir que
a cópia versionada está completa, e permitir reconstruir os arquivos se eles forem
perdidos antes de alguém conseguir copiá-los.

### `config.js` define dois globais

| Global | Campo | Quem usa | Para quê |
|---|---|---|---|
| `global.CARLA_CONFIG` | `nomesDiaSemana` | `cerebro-ia.js`, `storage-node.js` | nome do dia no prompt e no painel; lista de 7, índice 0 = domingo |
| | `duracaoConsultaMin` | `cerebro-ia.js:188` | duração da consulta em minutos; cai para `60` se ausente |
| | `endereco` | `server.js:256` | endereço no lembrete do dia da consulta |
| `global.EMERGENCIA_PALAVRAS` | (lista) | `cerebro-ia.js` | palavras que disparam emergência **antes** da IA |

`EMERGENCIA_PALAVRAS` é o insumo do invariante mais importante do sistema. A comparação é
feita em texto normalizado (minúsculas, sem acento), com `includes`. Perder esse arquivo
significa perder a detecção de emergência.

### `agenda.js` exporta

| Função | Quem usa | Papel |
|---|---|---|
| `toDateStr(date)` | `cerebro-ia.js`, `server.js` | data no formato usado como chave de slot |
| `formatHora(hora)` | `storage-node.js`, `server.js` | hora exibida para a família |
| `gerarSlotsPossiveis(now)` | `storage-node.js` | a grade semanal inteira |
| `disponiveis(now, ocupados)` | `cerebro-ia.js` | slots livres em ordem cronológica |
| `oferecerSlots(now, ocupados, filtros)` | `cerebro-ia.js` | slots livres com dia/período/data preferidos e `count` |
| `doisSeguidos(now, ocupados)` | `cerebro-ia.js` | dois slots realmente consecutivos (irmãos) |
| `ajustarHorario(...)` | `cerebro-ia.js` | valida o ajuste de até 30 minutos |

Formato de slot, confirmado pelo uso em `storage-node.js`: `{ id, date, time, label }`.

## Layout real do VPS

Confirmado em 29/07/2026. Vale registrar porque as primeiras instruções deste laboratório
supunham que `/root/carla` fosse o repositório, e não é:

```
/root/carla/                       pasta guarda-chuva, NÃO é repositório Git
├── auto-deploy.sh                 cron de deploy, roda a cada 3 minutos
├── deploy-cron.log
├── carla-app/                     app do navegador (config.js, agenda.js)
└── carla-whatsapp-bot/            ← O REPOSITÓRIO GIT
    ├── server.js, cerebro-ia.js, storage-node.js, painel-server.js
    ├── data/                      dados dos pacientes (fora do Git)
    └── carla-lab/                 este laboratório
```

Isso explica o `require(path.join(__dirname, "..", "carla-app", ...))` do código: o
`carla-app` é irmão da pasta do repositório, não filho dela.

## Estado

**Concluído em 29/07/2026.** Os dois arquivos estão em `arquivos/`, conferidos:
`config.js` exporta os 15 símbolos esperados e `agenda.js` as 8 funções, gerando a grade
correta de 16 horários por semana.
