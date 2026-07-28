# Roadmap

Sequência aprovada. Nenhuma fase começa sem a anterior estar concluída e validada.

A regra que atravessa todas: **a Carla que atende o consultório não muda de
comportamento em nenhuma delas.** Toda fase entra com comportamento observável idêntico,
e a suíte de regressão é quem diz se isso é verdade.

---

## Fase 0 · Rede de segurança

| Item | Estado |
|---|---|
| Versionar o que só existe no VPS (`carla-app/js/`) | **pendente** — depende de acesso ao servidor |
| Backups automáticos | pronto, testado fora do servidor |
| Ambiente de staging | pronto, aguardando montagem no VPS |
| Testes de regressão conversacional | pronto — 55 casos, 87 turnos, 41 de 41 comportamentos |

**Não concluída.** Sem `config.js` e `agenda.js` versionados, a Carla depende de dois
arquivos que existem em uma cópia só, sem histórico. Instruções em `vps/README.md`.

## Fase 1 · Perfil da clínica

| Item | Estado |
|---|---|
| Separar os dados da clínica do prompt | pronto |
| Criar o `PerfilClinica` | pronto — `perfil/dr-bruno.json` |
| Montar o prompt dinamicamente | pronto — `nucleo/compositor.js` |

**Implementada e validada:** 10 de 10 casos idênticos byte a byte ao prompt de produção,
em 5 datas × 2 tipos de contato.

Foi construída antes da Fase 0, fora de ordem. Depois revalidada sob a rede de segurança.
A inversão está registrada aqui de propósito, para não virar precedente.

## Fase 2 · Ports e adapters

Persistência, calendário, WhatsApp e LLM viram interfaces. Os adapters de hoje (arquivo
JSON, Google, Baileys, Anthropic) continuam sendo os padrões e continuam rodando.

Dois pontos que só cabem aqui, e que ficam caros depois:

- **Observabilidade de ferramenta.** Hoje `responder()` devolve os efeitos de uma
  resposta, não quais ferramentas foram chamadas. Por isso parte das asserções da suíte
  de regressão fica como PENDENTE. Quando as ferramentas virarem porta explícita, essas
  asserções passam a ser verificáveis.
- **Registro estruturado das conversas.** Analytics e dashboard de qualidade são Carla
  2.0, mas eles só conseguem analisar o que tiver sido gravado. Se a porta de persistência
  nascer sem guardar o histórico de forma estruturada, a Carla 2.0 começa com dado zero.
  Gravar agora é barato; dado retroativo não existe. Isto **não** é implementar analytics
  na Fase 2: é a porta já guardar o que ela vai precisar.

## Fase 3 · Carla Core

O Core vira pacote versionado e a Carla Original passa a consumi-lo. Ainda um processo,
um tenant, uma clínica.

Critério de aceite: duas semanas em produção sem regressão relatada.

## Fase 4 · SaaS

Multi-tenant, onboarding, contas, billing, painel, observabilidade.

A clínica piloto é **outra**, não a do Dr. Bruno. A Carla Original continua no arranjo da
Fase 3, intocada, o tempo todo.

## Fase 5 · Migrar a Carla Original

Só depois que outra clínica estiver rodando há semanas sem problema. Migração ensaiada em
staging antes, janela de baixo movimento, arranjo antigo de pé por 30 dias, rollback
ensaiado.

---

# Roadmap futuro · Carla 2.0

Começa **depois** da Fase 5. Não entra antes: são funcionalidades de produto, e construí-las
antes do Core existir significaria construí-las duas vezes.

- Treinar a Carla (o médico ajusta comportamento sem editar prompt)
- Sandbox
- Versionamento da personalidade
- IA supervisora
- Analytics das conversas
- Dashboard de qualidade
- Marketplace de integrações

## O que já existe de fundação para elas

Da Fase 1, sem custo adicional e sem nenhuma feature implementada:

| Carla 2.0 | Fundação que já está no lugar |
|---|---|
| Treinar a Carla | catálogo de 41 comportamentos com título e explicação em português, e trava nos 7 invariantes |
| Versionamento da personalidade | versão como delta sobre outra, com linhagem e volta atrás testada |
| Sandbox | compositor isolado: monta o prompt de qualquer versão sem tocar em produção |
| IA supervisora · Analytics · Dashboard | nada ainda — dependem do registro estruturado das conversas (ver Fase 2) |
| Marketplace de integrações | nada ainda — depende dos ports da Fase 2 |

Isso é preparação, não implementação. Não há tela, não há gravação de ajuste, não há
supervisor. O que existe é a arquitetura no formato certo para que essas features não
exijam refazer o Core depois.
