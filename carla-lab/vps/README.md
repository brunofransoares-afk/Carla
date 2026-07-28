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

## Como versionar (rode no VPS)

```bash
cd /root/carla

# 1. ver o que existe
ls -la carla-app/js/

# 2. copiar pra dentro do repositório, num branch que não vai pra produção
git fetch origin carla/lab
git checkout carla/lab
mkdir -p carla-lab/vps/arquivos
cp carla-app/js/config.js  carla-lab/vps/arquivos/config.js
cp carla-app/js/agenda.js  carla-lab/vps/arquivos/agenda.js

# 3. CONFERIR ANTES DE COMMITAR
#    Se houver chave, token ou senha dentro desses arquivos, PARE e me avise.
grep -niE 'key|token|senha|password|secret|credential' carla-lab/vps/arquivos/*.js

git add carla-lab/vps/arquivos
git commit -m "Versiona config.js e agenda.js, que so existiam no VPS"
git push origin carla/lab
```

O passo 3 não é formalidade. O repositório `Carla` é **público**. Enquanto esses arquivos
não forem lidos por alguém, não dá para afirmar que não contêm nada sensível. Rode o
`grep`, olhe o resultado, e só então commite.

Nada disso muda o comportamento da Carla: é cópia de arquivo, em branch que não vai para
`main`, e o `auto-deploy.sh` só faz `merge --ff-only` em `main`.

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

## Estado

**Pendente de você.** É o único item da Fase 0 que depende de acesso ao servidor. Enquanto
não for feito, a Fase 0 não está concluída, mesmo com todo o resto pronto: o backup cobre
os dados, e este item cobre o código que faz a Carla existir.
