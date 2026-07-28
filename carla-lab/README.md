# Carla Lab

Laboratório para desenvolver as funcionalidades novas da Carla sem encostar na Carla que
atende o consultório hoje.

## Por que isso não pode quebrar a Carla de produção

Três barreiras independentes, nesta ordem:

1. **Branch separado.** O `auto-deploy.sh` do VPS roda a cada 3 minutos e faz
   `git merge --ff-only` **apenas em `main`**. Este trabalho vive no branch `carla/lab`.
   Enquanto não houver merge em `main`, o servidor nunca vê estes arquivos.
2. **Diretório próprio.** Tudo mora em `carla-lab/`. Nenhum arquivo fora daqui foi
   alterado: nem `server.js`, nem `cerebro-ia.js`, nem `storage-node.js`, nem
   `package.json`. Rode `git diff origin/main --stat` para conferir.
3. **Sentido único da dependência.** O laboratório **lê** `cerebro-ia.js` para se comparar
   com ele. A produção não sabe que o laboratório existe, e nada aqui é importado por lá.

Nenhuma dependência nova: só a biblioteca padrão do Node.

## O que já funciona

### A personalidade da Carla virou dado

O prompt de produção foi separado em duas coisas que antes eram uma única string:

- `perfil/dr-bruno.json` — o que é do consultório: preço, chave Pix, endereço,
  credenciais, dias de atendimento.
- `personalidade/regras/*.md` — **41 comportamentos**, um arquivo cada, com título e
  explicação em português. É o que o médico vai ver e ajustar.

Cada regra traz `ajustavel: true|false`. As marcadas `false` são os **invariantes**:

| Regra | O que ela impede |
|---|---|
| Nunca dizer que marcou sem ter marcado | a Carla afirmar um agendamento que não existe |
| Nunca prometer sem agir | "só um instante" sem nada acontecer depois |
| Conferir se a consulta existe | responder de memória sobre uma consulta já cancelada |
| Nunca opinar sobre sintoma | a Carla dando parecer clínico |
| Emergência | emergência passando pela IA antes de escalar |
| Quem a Carla é / Data e hora | identidade e contexto, preenchidos pelo sistema |

O compositor **recusa** qualquer ajuste sobre essas regras. Não é convenção: é erro em
tempo de carga, testado.

### Está provado que nada mudou

`verificar-equivalencia.js` monta o prompt pelo caminho novo e compara, **byte a byte**,
com o que a `montarSystemPrompt()` do `cerebro-ia.js` real produz — em 5 datas
(incluindo o dia fechado e os dois dias de fim de semana) × família nova e família
conhecida.

```
10 de 10 casos idênticos byte a byte.
```

A comparação lê o `cerebro-ia.js` do repositório, não uma cópia. Se alguém mudar o prompt
em produção, este teste quebra e avisa que o laboratório ficou para trás.

### Versão de personalidade com volta atrás

Uma versão é um **delta** sobre outra, nunca uma cópia. `v2-exemplo.json` deriva de `v1`,
ajusta uma regra e desliga outra. Voltar é apontar para `v1` de novo: a versão anterior
continua intacta no disco.

## Comandos

```bash
node carla-lab/ferramentas/verificar-equivalencia.js   # prova que o lab == produção
node carla-lab/ferramentas/testar-versionamento.js     # prova ajuste, rollback e invariantes
node carla-lab/ferramentas/listar-regras.js [versao]   # catálogo do "Ensine a Carla"
node carla-lab/ferramentas/extrair.js                  # refaz a extração a partir do prompt real
```

## Como as cinco funcionalidades se apoiam nisto

| Funcionalidade | O que já existe | O que falta |
|---|---|---|
| **Ensine a Carla** | catálogo de 41 comportamentos com título, explicação e trava de invariante | tela de edição e gravação de ajuste |
| **Versionamento da personalidade** | versão como delta, linhagem, volta atrás testada | histórico com autor e data, botão no painel |
| **Sandbox** | compositor isolado: dá pra montar o prompt de qualquer versão sem tocar em produção | rodar a conversa de ponta a ponta contra a IA e comparar versões lado a lado |
| **Painel de qualidade** | — | métricas sobre as conversas já gravadas |
| **IA supervisora** | — | análise das conversas propondo ajuste de regra |

As três primeiras dependiam de prompt virar dado, que é o que esta etapa entrega. As duas
últimas dependem das conversas gravadas, que é a próxima etapa.

## Limite conhecido

`nomesDiaSemana` em `perfil/dr-bruno.json` é o único campo que **não** pôde ser conferido:
ele vem de `carla-app/js/config.js`, que não está versionado e só existe no VPS. Os valores
aqui são os nomes de dia usuais em português; a verificação de equivalência usa o mesmo
valor dos dois lados, então ela passa mesmo se o config.js real for diferente. Conferir no
servidor antes de confiar neste campo.
