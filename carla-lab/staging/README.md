# Ambiente de staging

Uma segunda Carla, completa, rodando ao lado da que atende o consultório, para testar
mudanças antes de qualquer família encostar nelas.

## A regra que não se negocia

**Nenhum efeito colateral do staging pode alcançar uma pessoa de verdade.** Nem mensagem
de WhatsApp, nem evento no Google Agenda, nem aviso no celular do médico. Um teste que
manda mensagem para uma família é pior do que não testar.

Isso significa quatro separações, e as quatro precisam estar certas antes de subir:

| O quê | Produção | Staging |
|---|---|---|
| Pasta | `/root/carla/carla-whatsapp-bot` | `/root/carla-staging` |
| Número de WhatsApp | número do consultório | **um chip só seu** |
| Google Agenda | agenda real do médico | calendário de teste |
| Aviso de agendamento | celular do Dr. Bruno | seu número de teste |

O número separado é o ponto mais perigoso: o Baileys **não aceita duas sessões no mesmo
número**. Se o staging autenticar com o número do consultório, a sessão de produção cai e
a Carla real para de responder. Confira duas vezes antes de ler o QR Code.

## Montagem (uma vez, no servidor)

```bash
# 1. cópia separada do código, no branch do laboratório
git clone /root/carla/carla-whatsapp-bot /root/carla-staging
cd /root/carla-staging
git fetch origin carla/lab && git checkout carla/lab

# 2. o carla-app precisa existir ao lado, igual em produção
cp -r /root/carla/carla-app /root/carla-app-staging
ln -s /root/carla-app-staging /root/carla-staging/../carla-app  # ajuste conforme seu layout

# 3. dados vazios: staging NUNCA parte dos dados reais de pacientes
mkdir -p /root/carla-staging/data /root/carla-staging/logs

# 4. conferir a configuração ANTES de subir
grep PREENCHER carla-lab/staging/ecosystem-staging.config.js   # não pode sobrar nenhum

# 5. subir e autenticar com o CHIP DE TESTE
pm2 start carla-lab/staging/ecosystem-staging.config.js
pm2 logs carla-staging-bot
```

O passo 3 é deliberado: staging começa com a agenda vazia. Copiar `data/` de produção
traria nome e telefone de crianças para um ambiente de teste, e não há motivo para isso.

## Rodar a suíte de regressão NÃO exige tudo isso

Correção de uma afirmação anterior deste documento: a suíte **não precisa de chip de
WhatsApp, nem de sessão do Baileys, nem deste staging completo**.

`executar.js` carrega `cerebro-ia.js` diretamente. Ele nunca carrega `server.js`, que é
quem fala com o WhatsApp. Nenhuma mensagem sai para ninguém, em nenhum cenário.

O Google Agenda se protege sozinho: `google-agenda.js` só age se **as duas** condições
forem verdadeiras, o arquivo `google-credenciais.json` existir e `GOOGLE_CALENDAR_ID`
estiver definida. Faltando qualquer uma, o módulo fica inerte por decisão do próprio
código, não por configuração que alguém possa esquecer.

Então para rodar a suíte basta um clone separado, sem credencial:

```bash
git clone /root/carla/carla-whatsapp-bot /root/carla-testes
cd /root/carla-testes
git remote set-url origin <url-do-github>
git fetch origin carla/lab && git checkout carla/lab
npm install

# o carla-app precisa estar ao lado, igual em produção
cp -r /root/carla/carla-app /root/carla-testes-app
# (ajuste o caminho conforme o layout do servidor)

mkdir -p data logs   # agenda vazia, nunca os dados reais

# NÃO copie google-credenciais.json pra cá. É essa ausência que garante
# que nenhum evento seja criado na agenda do médico.
ANTHROPIC_API_KEY="sua-chave" node carla-lab/regressao/executar.js
```

O staging completo abaixo continua sendo necessário para testar a Carla **de ponta a
ponta pelo WhatsApp**, com uma pessoa conversando com ela. Para a suíte de regressão, ele
é excesso.

**Custo.** A suíte tem 55 casos e 87 turnos. Cada turno é uma chamada ao Sonnet com um
prompt de ~24 mil caracteres, mais as chamadas de ferramenta. Uma rodada completa custa
alguns dólares, não centavos. Vale rodar por fase e antes de mudança grande, não a cada
commit. Enquanto não houver teto de custo por ambiente, rodar a suíte em laço é a forma
mais fácil de gerar uma fatura inesperada.

## O que não funciona em staging hoje

**O painel não sobe.** A porta está fixa no código (`painel-server.js:17`,
`const PORTA = 3355`), então uma segunda instância brigaria com a de produção. A correção
é uma linha, e preserva o comportamento atual:

```js
const PORTA = Number(process.env.PAINEL_PORTA) || 3355;
```

Sem `PAINEL_PORTA` definida, tudo continua exatamente como está hoje. Mesmo assim, isso
mexe em arquivo que a produção usa, e esta fase não altera produção. **Fica proposto,
aguardando sua aprovação.** Enquanto isso, staging roda só o bot, que é o que a suíte de
regressão precisa.

## Desligar

```bash
pm2 delete carla-staging-bot
```

O staging não precisa ficar de pé o tempo todo. Ele consome memória do mesmo VPS que
atende o consultório, e mantê-lo ligado sem necessidade rouba recurso da Carla real.
