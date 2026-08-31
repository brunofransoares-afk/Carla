# Carla — bot de WhatsApp

## Painel: ligar/desligar sem usar comando

Depois da primeira vez (veja abaixo), o dia a dia é só isto:

**Abra https://painel.drbrunosoares.med.br no navegador.** Lá tem os agendamentos,
os alertas e um botão pra ligar ou desligar a Carla, sem precisar mexer em comando.
O painel fica de pé mesmo com a Carla desligada — é um processo separado,
então dá pra religar por ele a qualquer momento.

## Primeira instalação

De dentro da pasta `carla-whatsapp-bot`:

Use Node 22.5 ou mais novo e crie o `.env` antes de iniciar. No mínimo,
`PAINEL_SENHA` precisa existir; sem ela o painel recusa abrir.

```
npm ci --omit=dev
npm run check
npm run start
```

Isso liga tanto a Carla quanto o painel. Se pedir para escanear QR code,
o arquivo aparece em `qr.png` na pasta. Depois disso, o resto é só pelo
painel no navegador.

O acesso público é feito pelo nginx da VPS, com HTTPS. O túnel temporário do
Cloudflare foi removido. O navegador abre uma página própria de entrada; nela,
digite o valor de `PAINEL_SENHA` do `.env` no campo de senha.

O painel agora **recusa iniciar** sem `PAINEL_SENHA`. A sessão do navegador é um
token aleatório, marcado `Secure` e `HttpOnly`; reiniciar o painel encerra as
sessões abertas. Nunca coloque a senha em commit ou em linha de comando.

## Comandos (só pra casos que o painel não cobre)

Rodar `node server.js` na mão é o que causou o problema de duas instâncias
brigando pela mesma conexão — nunca faça isso. Use sempre o PM2 pelos comandos
abaixo, de dentro da pasta `carla-whatsapp-bot`:

| Comando | O que faz |
|---|---|
| `npm run start` | Liga a Carla e o painel |
| `npm run stop` | Desliga a Carla (o painel continua de pé) |
| `npm run restart` | Reinicia a Carla (usa depois de qualquer alteração no código) |
| `npm run restart:painel` | Reinicia só o painel (usa depois de mexer em `painel-server.js` ou `dashboard.html`) |
| `npm run status` | Mostra o que está rodando, há quanto tempo, uso de memória |
| `npm run logs` | Mostra o que a Carla está fazendo em tempo real (Ctrl+C pra sair) |
| `npm run logs:painel` | Mesma coisa, só do painel |
| `npm run check` | Confere sintaxe e roda toda a bateria antes de publicar |
| `npm run backup` | Faz uma cópia consistente e verificada dos dados fora do repositório |

Se por algum motivo abrir duas vezes sem querer, o próprio programa recusa a
segunda instância com uma mensagem clara, então não corre mais risco de duplicar.

O cartão de estado do painel agora mostra duas coisas diferentes: se o processo da
Carla está ligado e se a sessão do WhatsApp está realmente conectada. Amarelo significa
que o processo está vivo, mas o WhatsApp está conectando, reconectando ou precisa de QR;
verde só aparece depois de a conexão real responder e continua exigindo um pulso recente.

## Onde estão os dados

- **Painel (agendamentos, alertas, ligar/desligar)**: https://painel.drbrunosoares.med.br
- **Agendamentos**: `data/agendamentos.csv` (abre no Excel) e `data/agendamentos.json`
- **Alertas de urgência / não entendidas**: `data/alertas.json`
- **Logs do bot**: `logs/saida.log` (mensagens normais) e `logs/erro.log` (erros)
- **Logs do painel**: `logs/painel-saida.log` e `logs/painel-erro.log`

Os logs passam por `log-seguro.js`: mensagens clínicas, argumentos de ferramenta,
telefones, e-mails e credenciais são removidos antes de chegarem ao PM2. Para
configurar rotação diária, compressão, limite de 10 MB e retenção de 14 arquivos:

```
bash scripts/configurar-logs.sh
```

Os valores podem ser ajustados por `CARLA_LOG_ROTATE_SIZE` e `CARLA_LOG_RETAIN`.

## Publicação segura

O deploy de produção deve chamar apenas:

```
bash /root/carla/carla-whatsapp-bot/scripts/deploy-seguro.sh
```

O script usa `flock` para impedir dois deploys simultâneos, recusa árvore suja,
valida o commit novo numa pasta descartável com `npm ci` e todos os testes, aceita
somente avanço direto de `main`, verifica a saúde e volta ao commit anterior em
caso de falha. Antes de reiniciar, também cria um backup com verificação de
integridade do SQLite. Ele preserva o estado dos processos: se a Carla estava
desligada pelo painel, uma publicação não a religa.

Exemplo de cron, a cada três minutos:

```
*/3 * * * * /usr/bin/bash /root/carla/carla-whatsapp-bot/scripts/deploy-seguro.sh >> /root/carla/deploy.log 2>&1
```

O GitHub Actions executa as mesmas verificações em Node 22 para todo PR e push
em `main`. Um PR não deve ser mergeado enquanto essa verificação estiver vermelha.

### Variáveis operacionais opcionais

- `PAINEL_LIMITE_CORPO_BYTES`: limite de cada corpo HTTP; padrão 64 KiB, máximo 1 MiB.
- `PAINEL_SESSAO_SEGUNDOS`: validade da sessão do painel; padrão 7 dias, máximo 60.
- `CARLA_LOG_MAX_LINE`: tamanho máximo de uma linha já redigida; padrão 2.000 caracteres.
- `CARLA_LOG_REDACT=0`: desliga a redação. Use apenas em teste local sem dados reais.
- `CARLA_BACKUP_DIR`: pasta externa dos backups; padrão `../backups`.
- `CARLA_BACKUP_RETER`: quantidade de cópias verificadas mantidas; padrão 30.

## Como a Carla pensa (a Claude conduz a conversa)

Desde a última atualização, quem escreve as respostas é a Claude (modelo
Sonnet), seguindo as regras de tom e conduta em `cerebro-ia.js` — não mais um
conjunto de respostas prontas escolhidas por palavra-chave. A conversa fica
bem mais natural: ela entende contexto, não repete informação já dada, e
percebe quando alguém está impaciente ou grosseiro.

O que **não** muda: preço, horário disponível e confirmação de agendamento
continuam 100% código. A IA nunca inventa um horário livre nem confirma uma
consulta sozinha — ela sempre consulta a agenda de verdade e só confirma
através de uma ferramenta que grava no sistema (e nunca deixa duplicar).
Emergência é detectada antes de qualquer coisa, sempre por palavra-chave,
nunca depende da IA.

Isso exige a chave da Anthropic configurada em `ANTHROPIC_API_KEY` no
arquivo `.env` — sem ela, o bot manda uma mensagem avisando que está fora do
ar no momento e não responde de verdade (diferente de antes, que funcionava
sem IA nenhuma). Como toda mensagem agora passa pela IA (não só quando as
regras travam), o custo por mês é maior — mas a conversa fica muito mais
natural.

A tela de teste no navegador (pasta `carla-app/`) continua funcionando do
jeito antigo, só com regras, sem precisar de chave nenhuma — ela não foi
alterada.

## Lembretes automáticos de consulta

Todo agendamento gera dois avisos automáticos por WhatsApp, sem precisar de
ninguém lembrar manualmente: um 1 semana antes da consulta, e outro no dia da
consulta (a partir das 8h). Isso é 100% código, roda de forma independente da
conversa (confere a cada 15 minutos) e nunca manda o mesmo lembrete duas vezes
pro mesmo agendamento.

## Liberar horários fora da grade (horários extras)

A grade padrão de atendimento é fixa (fica em `carla-app/js/agenda.js`), mas dá
pra liberar horários avulsos direto pelo painel, sem mexer em código — por
exemplo, abrir uma sexta à tarde numa semana específica.

No painel, clique no dia no calendário de "Bloqueio de agenda": além dos
horários da grade, aparece o campo **"Liberar horário"**. Digite a hora e
pronto — a Carla passa a poder oferecer e confirmar aquele horário. Os extras
aparecem com borda dourada e um `+`, e os chips logo abaixo removem.

Como o extra se comporta:
- **Pedido urgente** ("o quanto antes"): entra na ordem do tempo, junto com os
  da grade — se for o mais cedo, é oferecido primeiro.
- **Pedido normal**: entra depois dos da grade, de propósito. A preferência
  normal do consultório continua ganhando, e o extra funciona como capacidade
  a mais: aparece quando a grade não tem vaga, ou quando pedem justamente
  aquele dia/período.
- Respeita tudo que já existia: bloqueio do dia inteiro, bloqueio individual
  do horário, e some das ofertas assim que alguém marca.
- Horário extra que já passou é ignorado sozinho.
- Só dá pra remover um extra que **não** tem consulta marcada, pra nunca
  deixar uma consulta órfã.

Ficam guardados em `data/horarios-extras.json`.

## Aviso pro Dr. Bruno a cada agendamento novo

Toda vez que a Carla confirma um agendamento, ela manda uma mensagem de
WhatsApp (não notificação de navegador — mais confiável) pro número do Dr.
Bruno, avisando quem marcou e quando. Precisa de `DR_BRUNO_TELEFONE` no
`.env` (formato `+55...`). Sem essa variável, fica inerte, sem mandar nada.

## Integração com o Google Agenda (Onmed)

A Carla também consulta e cria eventos direto na agenda do Google que a Onmed
usa — assim ela nunca oferece nem confirma um horário que já esteja ocupado
lá (consulta da Onmed ou qualquer outro compromisso), não só o que está no
nosso arquivo local.

Precisa de dois arquivos/configurações:
- `google-credenciais.json` nesta pasta (a chave da conta de serviço do Google Cloud)
- `GOOGLE_CALENDAR_ID` no `.env`, com o ID da agenda

A agenda também precisa estar compartilhada com o e-mail `client_email` de
dentro do arquivo de credenciais, com permissão de **"Fazer alterações nos
eventos"**.

Sem essas duas coisas configuradas, esse reforço fica inerte e o bot segue
funcionando só com a checagem local, como sempre foi.

**Importante**: a sincronização entre a Onmed e o Google Agenda é só de mão
única (Onmed → Google). Isso significa que um agendamento que a Carla cria
aparece certinho no Google Agenda (evitando qualquer choque de horário), mas
**não cria o registro do paciente dentro da Onmed automaticamente** — isso
ainda precisa ser feito manualmente na Onmed quando for conveniente.

Quando um agendamento é cancelado pelo painel, o evento correspondente no
Google Agenda também é cancelado junto, automaticamente.

## Integração com o Sistema Pediátrico Integrado (prontuário)

Assim que a Carla confirma um agendamento (no mesmo momento em que cria o
evento no Google Agenda), ela também manda uma cópia desse agendamento pro
Sistema Pediátrico Integrado — outro projeto, separado deste, que cuida do
prontuário do paciente.

Precisa de duas variáveis no `.env`:
- `APP_SUPABASE_URL` — URL do projeto Supabase do Sistema Pediátrico Integrado
- `APP_CARLA_SECRET` — o mesmo segredo dedicado configurado como
  `CARLA_WEBHOOK_SECRET` na Edge Function. Se `PORTAL_WEBHOOK_SECRET` já estiver
  configurado com esse valor, ele é reutilizado automaticamente e
  `APP_CARLA_SECRET` pode ser omitido.

Sem a URL e um desses segredos, esse envio fica completamente inerte — a Carla
segue confirmando e gravando o agendamento normalmente aqui e no Google
Agenda, só não manda nada pro outro sistema. **Quando falta alguma, aparece um
aviso no `pm2 logs carla-bot`** dizendo qual: antes ele saía calado, e a cópia
podia estar desligada por meses sem ninguém notar.

Essa chamada é **fail-open**: se falhar (serviço fora do ar, chave errada,
timeout), só fica registrado no log — nunca desfaz nem atrasa o agendamento
de verdade, que já está confirmado antes dessa chamada acontecer.

### E-mail do responsável e nascimento da criança

A família responde esses dois dados **depois** que a consulta já está marcada,
numa mensagem seguinte. Quando isso acontece, a Carla também manda pro outro
sistema — e é isso que cria a **ficha do paciente** no prontuário e monta o
**acesso do responsável ao portal da criança**.

**Não precisa de variável nova.** Criar, completar e cancelar falam exclusivamente
com a Edge Function usando `APP_CARLA_SECRET` ou o `PORTAL_WEBHOOK_SECRET` já
existente. A Carla não usa `APP_SERVICE_ROLE_KEY` nem `APP_OWNER_ID`; esses valores
antigos podem ser retirados do servidor depois da validação em produção. A chave
administrativa continua somente dentro do Supabase, onde a função a usa após
validar o segredo estreito da integração.

Do outro lado, o acesso ao portal nasce **desligado**: o e-mail chegou digitado
no WhatsApp, sem verificação, e um dígito errado que caia numa caixa real daria
a um estranho acesso de leitura ao cartão de vacinas, ao crescimento e aos
documentos daquela criança. Quem libera é o Dr. Bruno, com um toque na Agenda
do SPI.

O sexo da criança **não é perguntado**: o outro sistema infere pelo primeiro
nome. Nome ambíguo (Alex, Ariel, Darci…) não é chutado — nesse caso a ficha não
é criada e o log avisa o motivo.

### Testes

`node tests/app-agenda.test.js` — 46 verificações, sem rede (o `fetch` é
substituído). Vale rodar depois de mexer neste arquivo: a integração roda em
background e falha em silêncio de propósito, então um erro aqui não aparece
sozinho.

## Avisar a família a pedido do prontuário

O prontuário do SPI manda a Carla avisar a família — o link do portal quando a
consulta é marcada, o link do guia quando a família paga. **São dois avisos
separados, de propósito**: um botão só faria um dos dois sair na hora errada, e
"seu guia está liberado" para quem não pagou é mensagem falsa saindo do WhatsApp
do consultório.

O caminho: prontuário → Edge Function `carla-agendamento` → painel da Carla →
porta interna do bot (a conexão do WhatsApp vive no processo dele). O painel
atende duas rotas que ficam **antes da checagem de senha**, porque quem chama é
máquina, não navegador:

```
POST /webhook/portal-liberado
POST /webhook/guia-liberado
X-Carla-Secret: <segredo>
{ "telefone": "+55..." }
```

### Duas variáveis no `.env`

- **`GUIA_URL`** = `https://guiapediatrico.drbrunosoares.med.br`
  Sem ela o aviso do guia **não sai**, e isso é intencional: mandar "seu guia
  está liberado!" sem link é pior que não mandar nada.

- **`PORTAL_WEBHOOK_SECRET`** (ou `APP_CARLA_SECRET`, aceito como reserva) =
  o mesmo valor do `CARLA_WEBHOOK_SECRET` que está nos secrets da função
  `carla-agendamento`, no Supabase do SPI.

  Sem nenhuma das duas, a porta responde **503 dizendo qual variável falta** —
  não 401. A diferença importa: um 401 sem motivo já custou uma noite inteira de
  investigação num login que estava certo.

  Usar o mesmo valor nas duas direções significa que vazar um lado vaza o outro.
  As duas pontas são as mesmas (SPI e Carla) e o SPI já guarda esse valor, então
  nada a mais fica exposto — mas se um dia um terceiro passar a falar com o
  painel, preencha o `PORTAL_WEBHOOK_SECRET` dedicado e pare de aceitar a
  reserva.

### Teste

```
npm test
```

A bateria roda todas as suítes, inclusive autorização do webhook, segurança do
painel e prévia de links, sem abrir uma porta real nem usar dados de pacientes.
