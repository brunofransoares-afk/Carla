# Carla AI — Documentação técnica

Estado do sistema em **29 de julho de 2026**. Este documento descreve o que existe, não o
que poderia existir. Nenhuma proposta, nenhuma recomendação.

Tudo aqui foi verificado lendo o código do repositório e a saída de comandos no servidor.
As poucas coisas não verificadas estão marcadas como tal.

---

## 1. O que é

Secretária virtual que atende pelo WhatsApp o consultório do Dr. Bruno Soares, pediatra em
Limeira/SP. Roda continuamente numa VPS. Conversa com as famílias usando IA, consulta a
agenda, marca e cancela consultas, envia lembretes e escala para atendimento humano quando
necessário.

O princípio que organiza o código: **a IA conduz a conversa, mas nunca decide preço,
disponibilidade nem confirmação de agendamento.** Isso é sempre código determinístico.

---

## 2. Onde roda

VPS Ubuntu, `191.252.221.109` (`vps68695`). Acesso por SSH como `root`.

### Layout no servidor

```
/root/carla/                       pasta guarda-chuva, NÃO é repositório Git
├── auto-deploy.sh                 script de deploy, chamado por cron
├── deploy-cron.log
├── carla-app/                     NÃO versionado no Git do bot
│   └── js/
│       ├── config.js              grade, valores, palavras de emergência
│       └── agenda.js              lógica de slots
└── carla-whatsapp-bot/            ← O REPOSITÓRIO GIT
    ├── server.js, cerebro-ia.js, storage-node.js, painel-server.js
    ├── google-agenda.js, app-agenda.js, dashboard.html
    ├── data/                      dados de pacientes (fora do Git)
    ├── logs/
    └── node_modules/
```

O código carrega `carla-app` como **pasta irmã** do repositório
(`require(__dirname, "..", "carla-app", "js", ...)`).

### Processos (PM2)

Definidos em `ecosystem.config.js`:

| Processo | Script | O que faz |
|---|---|---|
| `carla-bot` | `server.js` | conexão com o WhatsApp e atendimento |
| `carla-painel` | `painel-server.js` | painel web em `127.0.0.1:3355` |

Os dois são separados de propósito: o painel precisa continuar de pé mesmo com o bot
desligado, senão não haveria como religar o bot pela tela.

`carla-bot` tem `kill_timeout: 10000`, para dar tempo de responder mensagens que estejam
na fila antes de morrer.

### Rede

nginx na frente, com certificado Let's Encrypt, servindo o painel em
`painel.drbrunosoares.med.br`. Acesso pelo IP puro é rejeitado (`return 444`).

---

## 3. Arquivos do repositório

| Arquivo | Linhas | Responsabilidade |
|---|---|---|
| `server.js` | 428 | WhatsApp, fila, deduplicação, emergência, lembretes, ciclo de vida |
| `cerebro-ia.js` | 576 | prompt, ferramentas da IA, laço de conversa, travas de segurança |
| `storage-node.js` | 517 | toda a persistência, em arquivos JSON |
| `painel-server.js` | 327 | servidor HTTP do painel |
| `dashboard.html` | 912 | interface do painel |
| `google-agenda.js` | 94 | leitura e escrita no Google Agenda |
| `app-agenda.js` | 103 | espelhamento no Sistema Pediátrico Integrado |
| `ecosystem.config.js` | 40 | configuração do PM2 |
| `manifest.json`, `sw.js`, `icons/` | — | painel instalável como aplicativo |

**2.997 linhas no total**, sem contar `manifest.json`, `sw.js` e os ícones.

### Dependências

```json
"@anthropic-ai/sdk": "^0.110.0"
"@whiskeysockets/baileys": "^7.0.0-rc13"
"googleapis": "^173.0.0"
"qrcode": "^1.5.4"
```

Quatro no total. Nenhum framework web: o painel usa o módulo `http` nativo.

---

## 4. WhatsApp e Baileys

### Conexão

`server.js:314`. Usa `@whiskeysockets/baileys`, que é uma implementação **não oficial** do
protocolo do WhatsApp Web. Não é a Cloud API oficial da Meta. O comentário no topo do
arquivo registra isso e o risco de bloqueio.

```js
const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, "data", "auth"));
const sock = makeWASocket({ auth: state, printQRInTerminal: false, syncFullHistory: true });
```

A sessão fica em `data/auth/`, como centenas de arquivos pequenos (chaves de criptografia).
No servidor eram **1332 arquivos** em 29/07/2026.

### Autenticação

Na primeira conexão, o evento `connection.update` traz um QR code, que é gravado em
`qr.png` na raiz do repositório (400px). Ele é lido no celular em
Configurações → Aparelhos conectados.

### Reconexão

```js
if (connection === "close") {
  const codigo = lastDisconnect?.error?.output?.statusCode;
  const deveReconectar = codigo !== DisconnectReason.loggedOut;
  if (deveReconectar) iniciar();
}
```

Qualquer desconexão que não seja `loggedOut` dispara reconexão imediata, chamando
`iniciar()` de novo. `loggedOut` exige apagar `data/auth` e ler um QR novo.

A variável `sockAtivo` guarda o socket corrente; vira `null` ao desconectar e é
reatribuída em `connection === "open"`.

### Identificação de contato

O WhatsApp pode identificar o contato de duas formas:

- `@s.whatsapp.net` — número de telefone tradicional
- `@lid` — identificador interno, sem telefone visível

`telefoneDoJid(jid, remoteJidAlt)` (`server.js:82`) prioriza `remoteJidAlt` quando ele
termina em `@s.whatsapp.net`. Sem isso, produz uma chave `lid:xxxx`, que **não é um número
de telefone real**, apenas uma chave estável.

Telefones são normalizados como `"+" + numero` (`server.js:75`).

Grupos (`@g.us`), listas de transmissão e status são ignorados.

### Eventos escutados

| Evento | O que faz |
|---|---|
| `creds.update` | salva as credenciais da sessão |
| `connection.update` | QR code, reconexão, marca `sockAtivo` |
| `messages.upsert` | recebe mensagens (só `type === "notify"`) |
| `messaging-history.set` | popula contatos com o histórico enviado na conexão |
| `contacts.upsert` / `contacts.update` | contatos que ganham nome depois da conexão |

Nas sincronizações de histórico e contatos, **só** jids `@s.whatsapp.net` são aceitos. O
comentário no código explica: sem `remoteJidAlt` para cruzar, aceitar `@lid` criaria
contatos fantasma duplicados.

### Tipos de mensagem tratados

- `conversation` e `extendedTextMessage.text` — texto, processado normalmente
- `audioMessage` — resposta fixa pedindo para mandar por escrito (ver seção 7)
- Qualquer outro tipo é ignorado (texto vazio)

Mensagens com `msg.key.fromMe` (enviadas pelo próprio celular do médico) registram o
contato mas **nunca** são respondidas.

### Envio

`enviarResposta` (`server.js:112`) simula digitação antes de enviar:

```js
sock.presenceSubscribe(jid)
sock.sendPresenceUpdate("composing", jid)
await esperar(3000)                            // ATRASO_RESPOSTA_MS
sock.sendPresenceUpdate("paused", jid)
sock.sendMessage(jid, { text: texto })
```

O atraso de 3 segundos é pulado quando `semAtraso = true`, o que só acontece no
esvaziamento de fila durante o desligamento.

---

## 5. Filas e concorrência

Três mecanismos independentes.

### 5.1 Debounce de 6 segundos

`server.js:53`. No WhatsApp é comum a pessoa mandar o pensamento picado
("Boa noite" / "Consulta" / "Meu filho"). Em vez de responder cada uma, o sistema espera
silêncio e junta tudo.

```js
const DEBOUNCE_MS = 6000;
const buffers = new Map();  // telefone -> { textos, jid, timer }
```

Cada mensagem nova reinicia o timer do telefone. Quando o timer dispara, os textos
acumulados são unidos com `\n` e processados como uma só.

O buffer vive **em memória**. Reinício do processo perde o que estiver nele, exceto pelo
mecanismo da seção 5.3.

### 5.2 Deduplicação por id, janela de 10 minutos

`server.js:61`. O WhatsApp pode reentregar a mesma mensagem após uma reconexão. Se isso
acontecesse fora da janela do debounce, viraria um segundo processamento completo.

```js
const DEDUP_JANELA_MS = 10 * 60 * 1000;
const idsMensagensVistas = new Map();  // msg.key.id -> timestamp
```

A limpeza de ids antigos acontece dentro de `jaProcessouMensagem`, varrendo o Map inteiro
a cada chamada. Também vive em memória.

### 5.3 Esvaziamento no desligamento

`server.js:287`. Ao receber `SIGINT` ou `SIGTERM`, antes de sair o processo processa tudo
que estiver nos buffers, com `semAtraso: true`.

```js
process.on("SIGINT",  () => encerrarComCalma("SIGINT"));
process.on("SIGTERM", () => encerrarComCalma("SIGTERM"));
```

Sem isso, quem mandasse mensagem no instante de um `pm2 restart` nunca receberia resposta.
A flag `encerrando` impede execução dupla.

### 5.4 Trava de instância única

`server.js:34`. O processo abre um servidor HTTP em `127.0.0.1:3357` que responde `"ok"`.
Se a porta já estiver ocupada (`EADDRINUSE`), encerra com código 1.

Existe porque duas instâncias brigando pela mesma sessão do WhatsApp derrubam uma à outra.

### 5.5 Concorrência

Não há fila de trabalho nem limite de paralelismo. Cada telefone tem seu próprio buffer, e
mensagens de telefones diferentes são processadas em paralelo, limitadas apenas pelo laço
de eventos do Node.

---

## 6. IA

### Modelo e parâmetros

`cerebro-ia.js:22`

```js
const MODELO = "claude-sonnet-5";
max_tokens: 1500
maxIteracoes: 4          // no laço de ferramentas
```

O comentário registra a escolha: Sonnet em vez de Haiku porque este módulo conduz a
conversa inteira e orquestra várias ferramentas em sequência.

A IA só é usada se `ANTHROPIC_API_KEY` existir. Sem ela, `responder()` devolve uma frase
fixa dizendo que alguém da equipe responde em breve.

### O prompt

Montado a cada mensagem por `montarSystemPrompt(now, pacienteConhecido)`. Tem
**24.499 caracteres** numa segunda-feira de manhã, para família nova e contém, em blocos separados por linha em branco:

identidade, data e hora atuais, tom de voz, regra de saudação, estrutura da primeira
mensagem (duas versões: família nova e paciente conhecido), currículo do médico, fatos do
consultório, como informar preço, convite para agendar, proibição de justificar o valor,
ordem da conversa, como agendar, não repetir horários, dia sem atendimento, urgência,
encaixe, coleta de nomes, irmãos, ajuste de horário, trava de confirmação, proibição de
promessa sem ação, mensagem pós-confirmação, envio dos dados de pagamento, continuidade,
despedida, silêncio, recusa, cancelamento, verificação de agendamento existente, tom com
pessoa irritada, emergência, proibição de opinião clínica, atendimento de fim de semana,
como falar de escalonamento, quando escalar, contato comercial, e uma lista final de
"nunca".

Duas interpolações mudam o prompt em tempo de execução: a data formatada e um aviso extra
quando o telefone é de paciente conhecido.

### As quatro ferramentas

`cerebro-ia.js:195`. São a fronteira entre o que a IA decide e o que o sistema garante.

| Ferramenta | Parâmetros | O que faz |
|---|---|---|
| `consultar_horarios` | `dia`, `periodo`, `data`, `doisSeguidos`, `urgente` | lê a agenda real e devolve horários livres |
| `confirmar_agendamento` | `slotId`, `slotLabel`, `responsavel`, `crianca`, `horarioAjustado` | grava a reserva de verdade |
| `cancelar_agendamento` | `slotId`, `apenasConsultar` | cancela, ou apenas verifica se existe |
| `escalar_humano` | `motivo`, `tipo` (`atendimento` ou `comercial`) | registra alerta e marca a conversa |

### O laço de conversa

`chamarClaudeComFerramentas` (`cerebro-ia.js:464`), no máximo 4 iterações:

1. chama o modelo com o prompt, o histórico e as ferramentas
2. acumula o texto **de todos os turnos**, não só do último
3. se `stop_reason !== "tool_use"`, devolve o texto acumulado
4. senão, executa cada ferramenta pedida e devolve os resultados ao modelo

O acúmulo de texto de todos os turnos é deliberado, e o comentário explica: a Claude às
vezes escreve algo (informar um valor) na mesma resposta em que já chama uma ferramenta.
Pegar só o texto final perderia aquele trecho.

Se as 4 iterações se esgotarem sem texto, devolve
`"Deixa eu confirmar uma informação rapidinho e já te retorno 😊"`.

`stop_reason === "max_tokens"` é registrado no log de erro.

### Travas de segurança pós-resposta

`cerebro-ia.js:548`. Depois que o modelo responde, o texto é verificado por expressão
regular antes de sair:

```js
/deixei\s+reservad|\breservei\b|agendamento\s+(está\s+)?confirmad|.../i
```

Se o texto **parece** confirmar uma reserva mas `confirmar_agendamento` não foi chamada com
sucesso naquela resposta, o texto é **descartado** e substituído por
`"Só um instante, deixa eu confirmar certinho esse horário antes de fechar 😊"`.
O incidente vai para o log de erro com o texto descartado.

Existe uma trava equivalente para cancelamento.

### SILENCIO

Se a resposta do modelo, aparada e em maiúsculas, for exatamente `"SILENCIO"`, nenhuma
mensagem é enviada. O histórico registra `"(ficou em silêncio, sem responder)"`.

---

## 7. Emergência

O caminho mais curto do sistema, e o único que nunca passa pela IA.

`server.js:159`, antes de qualquer outra coisa:

```js
if (CerebroIA.pareceEmergencia(texto)) { ... }
```

`pareceEmergencia` normaliza o texto (minúsculas, sem acento) e verifica se contém alguma
das palavras de `global.EMERGENCIA_PALAVRAS`, definida em `carla-app/js/config.js`. Em
29/07/2026 a lista tem **68 palavras**.

Resposta fixa:

```
Isso parece ser uma emergência.

Por favor, leve a criança agora para o pronto-socorro mais próximo.

Vou avisar o Dr. Bruno sobre esse contato assim que possível.
```

Também: registra alerta do tipo `emergencia`, limpa `aguardandoHumano`, grava a sessão.

A verificação de emergência acontece **antes** da checagem de contato silenciado. Um número
silenciado manualmente ainda recebe resposta de emergência.

### Áudio

`server.js:130`. A Carla não transcreve áudio. Qualquer `audioMessage` recebe uma resposta
fixa pedindo para mandar por escrito. Nunca passa pela IA. Respeita silenciamento manual e
atendimento humano em andamento.

---

## 8. Contexto e memória

### Sessão

Uma por telefone, em `data/sessoes.json`. Formato:

```js
{
  telefone,
  historico: [],              // [{ role, content }]
  aguardandoHumano: false,
  aguardandoHumanoDesde: null,
  ultimaAtividade,            // ISO
  ultimaMensagem,             // 140 caracteres
  ultimoAgendamento           // { crianca, label }
}
```

### Histórico

Cortado em **24 entradas** (`slice(-24)`), ou seja, aproximadamente 12 trocas. É o que vai
para a IA a cada mensagem, junto do prompt.

Não há resumo, compactação nem memória de longo prazo. O que sai das 24 entradas é
esquecido para sempre.

### Aguardando humano

Quando a IA chama `escalar_humano`, a sessão marca `aguardandoHumano = true` e a Carla fica
em silêncio naquela conversa.

**Expira em 2 horas** (`AGUARDANDO_HUMANO_EXPIRA_MS`). Passado esse tempo sem ninguém dar
seguimento, a Carla retoma o atendimento sozinha na mensagem seguinte.

Também pode ser desfeito manualmente pelo painel (`/api/retomar-atendimento`).

### Paciente conhecido

`Storage.ehPacienteConhecido(telefone)` decide como a Carla se apresenta. A ordem de
avaliação é:

1. se está em `nao-pacientes-manuais.json`, **não** é paciente (vence tudo)
2. se o contato tem `nomeSalvo`, é paciente
3. senão, se está em `pacientes-manuais.json`, é paciente

---

## 9. Persistência

Tudo em arquivos JSON, em `data/`. Sem banco de dados. Sem transações. Escrita síncrona
com `fs.writeFileSync`.

| Arquivo | Conteúdo |
|---|---|
| `agendamentos.json` | as consultas marcadas |
| `agendamentos.csv` | a mesma coisa em CSV, reescrito a cada mudança (com BOM) |
| `sessoes.json` | histórico e estado das conversas |
| `alertas.json` | o que precisa de atenção humana |
| `contatos-whatsapp.json` | nomes e telefones vindos do WhatsApp |
| `pacientes-manuais.json` | marcados como paciente pelo painel |
| `nao-pacientes-manuais.json` | desmarcados pelo painel |
| `contatos-silenciados.json` | números que a Carla ignora |
| `bloqueios.json` | dias inteiros bloqueados |
| `bloqueios-horarios.json` | horários específicos bloqueados |
| `horarios-extras.json` | horários liberados fora da grade |
| `auth/` | sessão do WhatsApp (Baileys) |

`storage-node.js` exporta **39 funções**.

### Formato de um agendamento

```js
{
  slotId,                 // "2026-08-03T08:00"
  data,                   // "2026-08-03"
  horario,                // "08:00"
  diaLabel,               // "segunda-feira (03/08) às 8h"
  responsavel, crianca, telefone,
  registradoEm,           // ISO
  lembretes: { semanaAntes: false, diaDaConsulta: false },
  googleEventId,
  appAgendamentoId
}
```

`reservar()` devolve `false` se o `slotId` já existir. É a última defesa contra duas
famílias no mesmo horário.

### `data/` fora do Git

`.gitignore` exclui `data/`, `.env`, `google-credenciais.json`, `logs/`, `qr.png` e
`node_modules/`.

---

## 10. Agenda e horários

### A grade

Definida em `carla-app/js/config.js`, em `janelasSemanais`, indexada pelo dia da semana do
JavaScript (0 = domingo):

```js
1: [08:00–12:00, 14:00–16:30]   // segunda
2: [08:00–12:00, 14:00–15:00]   // terça
3: []                            // quarta, sem atendimento
4: [08:00–12:00, 14:00–16:00]   // quinta
5: [08:00–12:00]                 // sexta, só manhã
6: [], 0: []                     // fim de semana
```

Outros valores: `duracaoConsultaMin: 60`, `intervaloMin: 30`, `horizonteDias: 30`.

Os horários de início são calculados por `horariosDaJanela`, com passo de 90 minutos
(60 de consulta + 30 de intervalo), sem ultrapassar o fim da janela. Resultado:

```
segunda  08:00  09:30  11:00  14:00  15:30
terça    08:00  09:30  11:00  14:00
quarta   (nada)
quinta   08:00  09:30  11:00  14:00
sexta    08:00  09:30  11:00
```

**16 horários por semana**, 73 no horizonte de 30 dias.

### Slot

```js
{ id: "2026-08-03T08:00", date, time, weekday, dateObj, label }
```

Horários extras usam id `extra-YYYY-MM-DD-HH:MM` e carregam `extra: true`.

### Funções de `agenda.js`

`gerarSlotsPossiveis`, `disponiveis`, `oferecerSlots`, `doisSeguidos`, `ajustarHorario`,
`formatHora`, `toDateLabel`, `toDateStr`.

`oferecerSlots` sem filtro específico prioriza dias que **já têm outra consulta marcada**,
para concentrar as idas ao consultório, e usa `escolherComDiversidade` para evitar oferecer
dois horários do mesmo dia ou do mesmo período.

`CARLA_CONFIG.preferenciaPadrao` existe em `config.js` mas **não é lido por nenhum arquivo
do sistema**. Verificado por busca em todo o código.

### Ocupado

`Storage.idsOcupados(now)` devolve um `Set` com:
- os `slotId` de todos os agendamentos
- todos os slots dos dias em `bloqueios.json`
- os ids em `bloqueios-horarios.json`

### Ajuste de até 30 minutos

`ajustarHorario` aceita mover um horário oferecido em até 30 minutos, e recusa se: passar
de 30 minutos, cair fora da janela do dia, ficar a menos de 90 minutos de outra consulta do
mesmo dia, ou já ter passado.

---

## 11. Integrações externas

### Google Agenda

`google-agenda.js`. Autenticação por conta de serviço, arquivo `google-credenciais.json` na
raiz do repositório. Calendário definido por `GOOGLE_CALENDAR_ID`.

```js
function disponivel() {
  return !!calendarId() && fs.existsSync(CAMINHO_CREDENCIAIS);
}
```

**Se faltar qualquer uma das duas condições, o módulo fica inerte.** Não é configuração
opcional que alguém possa esquecer de desligar: o próprio código verifica.

| Função | Devolve |
|---|---|
| `estaLivre(inicio, fim)` | `true`, `false`, ou **`null` quando não deu para checar** |
| `criarEvento({...})` | id do evento, ou `null` |
| `cancelarEvento(eventId)` | booleano |

O `null` de `estaLivre` é tratado como "segue com a checagem local". Uma falha no Google
nunca impede um agendamento.

### Sistema Pediátrico Integrado (SPI)

`app-agenda.js`. Espelha os agendamentos num projeto Supabase separado.

```
POST   {APP_SUPABASE_URL}/rest/v1/agendamentos
PATCH  {APP_SUPABASE_URL}/rest/v1/agendamentos?id=eq.{id}
Authorization: Bearer {APP_SERVICE_ROLE_KEY}
```

Escreve **direto na tabela**, sem passar por API. Corpo enviado:

```js
{
  owner_id, paciente_nome, responsavel_nome, data_nascimento,
  telefone, inicio, fim, observacoes,
  origem: "carla", status: "agendado"
}
```

O cancelamento marca `status: "cancelado"` e nunca apaga o registro.

Timeout de 8 segundos. Fail-open: qualquer falha é registrada no log e o fluxo segue. É
mão única: o SPI nunca envia nada de volta para a Carla.

Inerte se faltar `APP_SUPABASE_URL`, `APP_OWNER_ID` ou `APP_SERVICE_ROLE_KEY`.

---

## 12. Agendadores

Três coisas rodam por tempo, em dois lugares diferentes.

### 12.1 Lembretes — `setInterval` dentro do processo

`server.js:280`

```js
setInterval(checarLembretes, 15 * 60 * 1000);   // a cada 15 minutos
```

`checarLembretes` (`server.js:270`) só age se todas forem verdadeiras:
- `sockAtivo` existe (WhatsApp conectado)
- a hora atual é **8h ou mais** (`HORA_LEMBRETES = 8`)
- os lembretes de hoje ainda não foram enviados (`ultimoDiaLembretesEnviados`)

Também é chamado uma vez em `connection === "open"`.

`ultimoDiaLembretesEnviados` vive **em memória**. Um reinício do processo no mesmo dia
permite que a checagem rode de novo; o que evita reenvio de fato é a marcação por
agendamento em disco.

Dois tipos de lembrete:

| Tipo | Quando | Texto |
|---|---|---|
| `semanaAntes` | consulta daqui a 7 dias | "Passando pra lembrar que a consulta de X está agendada para Y" |
| `diaDaConsulta` | consulta hoje | "Bom dia! Só confirmando: hoje é o dia da consulta..." + endereço |

`agendamentosProntosParaLembrete(hojeStr, tipo)` filtra por três condições:
- `telefone` é string e **começa com `+`**
- a data bate com o alvo (para `semanaAntes`, hoje + 7 dias)
- o lembrete daquele tipo ainda não foi marcado

O filtro do `+` exclui agendamentos lançados pelo painel com telefone de placeholder.

### 12.2 Deploy automático — cron do sistema

```
*/3 * * * * /root/carla/auto-deploy.sh >> /root/carla/deploy-cron.log 2>&1
```

A cada 3 minutos: `git fetch`, `git merge --ff-only` **apenas na branch `main`**,
`npm install` se `package.json` mudou, e `pm2 restart ecosystem.config.js --update-env`.

Branches que não sejam `main` nunca chegam ao servidor por esse caminho.

### 12.3 Backup — cron do sistema

```
0 3 * * * /root/backup-carla.sh >> /root/carla/carla-whatsapp-bot/logs/backup.log 2>&1
```

Instalado em 29/07/2026. Todo dia às 3h empacota `data/` em
`/root/backups/carla/carla-dados-AAAA-MM-DD_HHMM.tar.gz`, verifica que
`agendamentos.json`, `contatos-whatsapp.json` e `sessoes.json` estão dentro, e apaga
pacotes com mais de 30 dias preservando sempre o mais recente.

O pacote inclui `data/auth/`, ou seja, **contém as credenciais da sessão do WhatsApp**.

---

## 13. Painel

`painel-server.js`, porta **3355**, escutando apenas em `127.0.0.1`. A porta está fixa no
código (`const PORTA = 3355`), sem variável de ambiente.

Autenticação por **senha única**, em `PAINEL_SENHA`. Não há conceito de usuário.

Interface em `dashboard.html` (arquivo único, sem framework). Instalável como aplicativo
via `manifest.json` e `sw.js`.

### Rotas

```
/api/status                    /api/dados                  /api/horarios-do-dia
/api/ligar                     /api/desligar
/api/cancelar                  /api/limpar-conversa        /api/limpar-alertas
/api/retomar-atendimento
/api/silenciar                 /api/dessilenciar
/api/marcar-paciente           /api/desmarcar-paciente
/api/bloqueio-toggle           /api/bloqueio-horario-toggle
/api/horario-extra             /api/horario-extra-remover
/manifest.json                 /sw.js                      /icons/
```

`/api/ligar` e `/api/desligar` controlam o processo `carla-bot` via `child_process.exec`
com comandos do PM2.

`/api/horario-extra` valida data e hora no servidor por expressão regular
(`^\d{4}-\d{2}-\d{2}$` e `^([01]\d|2[0-3]):[0-5]\d$`).

O painel usa 23 funções do `storage-node.js`, contra 7 do `cerebro-ia.js` e 9 do
`server.js`.

---

## 14. Variáveis de ambiente

Carregadas por `process.loadEnvFile()` num `try/catch` — sem `.env`, o processo sobe do
mesmo jeito.

| Variável | Usada em | Sem ela |
|---|---|---|
| `ANTHROPIC_API_KEY` | `cerebro-ia.js` | a IA não roda; resposta fixa de indisponibilidade |
| `DR_BRUNO_TELEFONE` | `server.js` | não avisa sobre agendamentos novos |
| `GOOGLE_CALENDAR_ID` | `google-agenda.js` | integração inerte |
| `PAINEL_SENHA` | `painel-server.js` | — |
| `APP_SUPABASE_URL` | `app-agenda.js` | espelhamento inerte |
| `APP_SERVICE_ROLE_KEY` | `app-agenda.js` | espelhamento inerte |
| `APP_OWNER_ID` | `app-agenda.js` | espelhamento inerte |

---

## 15. Fluxo completo de uma mensagem

```
Família manda mensagem no WhatsApp
  │
  ├─ Baileys, evento messages.upsert (só type === "notify")
  ├─ tem msg.message? senão descarta
  ├─ jaProcessouMensagem(msg.key.id)? se sim, descarta
  ├─ jid é @s.whatsapp.net ou @lid? senão descarta (grupos, status)
  ├─ telefoneDoJid(jid, remoteJidAlt)
  ├─ msg.key.fromMe? registra contato e para
  ├─ registrarContatoWhatsapp(telefone, { pushName })
  ├─ é audioMessage? resposta fixa e para
  ├─ texto vazio? descarta
  └─ agendarProcessamento → buffer, timer de 6s
       │
       └─ (6s de silêncio) → processarMensagem
            │
            ├─ 1. pareceEmergencia?  ──► resposta fixa + alerta + FIM (não chama IA)
            ├─ 2. contatoSilenciado? ──► FIM, sem responder
            ├─ 3. aguardandoHumano e não expirou (2h)? ──► FIM, sem responder
            │
            ├─ 4. idsOcupados()
            ├─ 5. ehPacienteConhecido()
            └─ 6. CerebroIA.responder(...)
                   │
                   ├─ monta o prompt (~24.500 caracteres)
                   ├─ laço de até 4 iterações com a Claude
                   │    └─ ferramentas: consultar_horarios, confirmar_agendamento,
                   │       cancelar_agendamento, escalar_humano
                   ├─ trava: texto parece confirmação sem a ferramenta ter rodado? descarta
                   └─ devolve { resposta, historico, acoes, cancelamentos, escalar }
                        │
                        ├─ para cada ação: log + notifica o médico por WhatsApp
                        ├─ se escalar: aguardandoHumano = true + alerta
                        ├─ salvarSessao
                        ├─ resposta null (SILENCIO)? FIM
                        └─ enviarResposta: "digitando" 3s, envia
```

---

## 16. Características do estado atual

Fatos, sem juízo de valor.

- **Canal não oficial.** Baileys, não a Cloud API da Meta. Documentado no topo do
  `server.js`.
- **Um processo, um número, uma clínica.** Não existe `clinicaId` em nenhuma assinatura de
  função. A configuração é escalar, por variável de ambiente.
- **Dados da clínica dentro do prompt.** R$ 550, R$ 800, chave Pix, link de pagamento,
  endereço e faixa etária estão escritos como texto no `cerebro-ia.js`, e alguns também em
  `config.js`.
- **`carla-app/js/` não está versionado** no repositório do bot. Existe apenas no VPS.
- **Persistência em arquivo**, sem transação e sem isolamento.
- **Painel com senha única**, sem usuários nem papéis.
- **Sem teto de custo de IA.** Nenhum limite de gasto por período ou por conversa.
- **Sem testes automatizados** no código de produção. Existe uma suíte no branch
  `carla/lab`, que não está em `main`.
- **Estado em memória:** buffers de debounce, ids de deduplicação e
  `ultimoDiaLembretesEnviados` são perdidos a cada reinício. Só o primeiro tem tratamento
  no desligamento.
- **`npm run restart:tunnel` e `npm run link`** referenciam um processo PM2 chamado
  `carla-tunnel`, que não existe mais no `ecosystem.config.js`.
- **O `README.md` descreve um túnel Cloudflare** que não é mais usado; hoje o acesso é por
  nginx com domínio próprio.

---

## 17. O que não foi verificado

- **Os demais arquivos de `carla-app/`.** Apenas `config.js` e `agenda.js` foram lidos. A
  pasta tem outros arquivos (a tela de teste no navegador) que não foram examinados.
- **O conteúdo do `.env` no servidor.** Sabe-se quais variáveis o código lê, não quais
  estão preenchidas.
- **O `auto-deploy.sh` na íntegra.** O comportamento descrito veio de uma captura de tela
  do arquivo, não de leitura direta.
- **O Sistema Pediátrico Integrado.** Repositório privado, não acessado. Sabe-se apenas o
  que a Carla envia para ele.
