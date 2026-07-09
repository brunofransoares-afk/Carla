# Carla — bot de WhatsApp

## Painel: ligar/desligar sem usar comando

Depois da primeira vez (veja abaixo), o dia a dia é só isto:

**Abra http://localhost:3355 no navegador.** Lá tem os agendamentos, os alertas
e um botão pra ligar ou desligar a Carla, sem precisar mexer em nenhum comando.
O painel fica de pé mesmo com a Carla desligada — é um processo separado,
então dá pra religar por ele a qualquer momento.

## Primeira vez / depois de reiniciar o computador

De dentro da pasta `carla-whatsapp-bot`:

```
npm run start
```

Isso liga tanto a Carla quanto o painel. Se pedir para escanear QR code,
o arquivo aparece em `qr.png` na pasta. Depois disso, o resto é só pelo
painel no navegador.

## Acessar o painel pelo celular (de qualquer lugar)

O painel também fica disponível por um link público, via um túnel do Cloudflare
(`carla-tunnel`), protegido por senha.

1. **Descubra o link atual**: `npm run link` — procure uma linha com
   `https://alguma-coisa.trycloudflare.com`. Esse link **muda toda vez que o
   túnel reinicia** (ex: depois de reiniciar o computador), então confira de
   novo se parar de funcionar.
2. **Abra esse link no navegador do celular.** Vai pedir usuário e senha —
   usuário pode ser qualquer coisa, a senha é a que está em `PAINEL_SENHA`
   no arquivo `.env`.
3. Pode salvar o link na tela inicial do celular pra acessar rápido (mas
   lembre que ele muda se o túnel reiniciar).

Sem `PAINEL_SENHA` configurada no `.env`, o painel funciona sem senha nenhuma
— assim ficava antes, só pra uso local. Com a senha configurada, ela passa a
ser exigida também no acesso local (http://localhost:3355), não só remoto.

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
| `npm run link` | Mostra o link público atual pra acessar o painel do celular |
| `npm run restart:tunnel` | Reinicia o túnel (gera um link novo) |

Se por algum motivo abrir duas vezes sem querer, o próprio programa recusa a
segunda instância com uma mensagem clara, então não corre mais risco de duplicar.

## Onde estão os dados

- **Painel (agendamentos, alertas, ligar/desligar)**: http://localhost:3355
- **Agendamentos**: `data/agendamentos.csv` (abre no Excel) e `data/agendamentos.json`
- **Alertas de urgência / não entendidas**: `data/alertas.json`
- **Logs do bot**: `logs/saida.log` (mensagens normais) e `logs/erro.log` (erros)
- **Logs do painel**: `logs/painel-saida.log` e `logs/painel-erro.log`
- **Logs do túnel (link público)**: `logs/tunnel-saida.log` e `logs/tunnel-erro.log`

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

## Link da página de materiais

Depois que a conversa termina, a Carla pode mandar um recado avulso com o
link da página de materiais do Dr. Bruno (a página em si é outro projeto,
separado deste). Só cortesia — ela nunca vende nem faz pitch, só entrega o
link.

- Se a família **mandar uma imagem que parece comprovante de pagamento**
  (foto de Pix, transferência ou recibo) num telefone que já tem consulta
  marcada: manda um recado de boas-vindas com o link, como um presente. Uma
  IA rápida (Haiku, bem mais barata que a que conduz a conversa) só confere
  se a imagem parece mesmo um comprovante — não existe um evento de
  "pagamento confirmado" de verdade no sistema, então isso é o sinal mais
  confiável disponível. Imagem que não parecer comprovante é ignorada, do
  jeito que já era antes (a Carla não processa imagem na conversa normal).
- Se terminou **sem agendamento** (a família desistiu ou se despediu sem
  marcar): manda um convite leve com o link, sem insistir.

Nunca manda os dois no mesmo atendimento, nunca repete pro mesmo telefone
antes de 90 dias, e nunca manda em cima de uma tentativa frustrada de
agendar.

Precisa de `LINK_MATERIAIS_URL` no `.env`, com a URL final da página. **Sem
essa variável configurada, o recurso fica completamente inerte** — não manda
nada, não muda nenhum outro comportamento da Carla.
