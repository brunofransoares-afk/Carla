# Repaginada do painel da Carla (outubro de 2026)

Pedido do dono: trazer para a Carla algumas funções da plataforma Oculoplastic e refazer o
layout para facilitar o acesso e a visualização. Só o painel muda (`dashboard.html`,
`painel-server.js`, `crm.js` e um módulo novo, `painel-hoje.js`). O bot (Baileys) não é tocado.

## 1. O que o painel tinha

- Quatro abas: Visão geral, Famílias, Agenda e Funil. Oito números no topo (consultas hoje,
  7 dias, pagamento, aguardando você, leads quentes, pós-consulta, retornos, conversão).
- Visão geral: alertas da Carla, "Precisa de ação" (10 itens), próximas consultas e o anel de conversão.
- Famílias: lista com filtros por situação (`crm.js`: 11 situações), busca, ficha com ações no topo,
  consultas, portal, retornos de 3 e 6 meses, modelos de pós-consulta, notas, etiquetas, linha do tempo.
- Funil: etapas com a maior queda em número absoluto. Estágios: Chamou, Soube o valor, Recebeu horário,
  Agendou, Pagou.
- Problemas de uso: o controle da Carla e oito cartões ocupavam o topo de toda aba; a navegação era
  uma faixa de texto de 13 px; a busca só existia dentro de Famílias; muita letra de 10 a 11 px.

## 2. O que a Oculoplastic tem e o que entra

| Função da Oculoplastic | Entra? | Dado real na Carla |
|---|---|---|
| Pendências do dia (`pendencias.js`) | Sim, é a tela "Hoje" | situações do CRM, agenda, eventos |
| Funil com taxa de passagem e gargalo (`metricas.js`) | Sim | etapas do funil já gravadas |
| Origem do contato, em lista editável | Sim | campo novo `origens` em `data/crm.json` |
| Follow-up com prazo (7 e 30 dias) | Sim | atividade da família e mensagens do consultório |
| Motivo de perda | Sim | campo novo `perdas` em `data/crm.json` |
| Mês atual contra o anterior (`periodos`) | Sim | contatos, agendamentos e pagamentos com data |
| Relatório semanal simples | Sim, com botão de copiar | mesmos dados, recorte de segunda a domingo |
| Faturamento recebido | Sim | consultas marcadas como Pago, com o preço da tabela |
| Despesas | Não | a Carla não guarda despesa; sem dado, sem tela |
| Voz, mentor, plano de ação, conteúdo | Não | não fazem sentido para um consultório pediátrico |

Regra mantida da Oculoplastic: **o que não foi registrado não é zero**. Sem dado a tela diz
"sem dado ainda". O mês anterior só é comparado se existe registro anterior ao mês atual.
O faturamento só soma consulta Paga com tipo conhecido; as pagas sem tipo aparecem contadas à parte
e não entram no valor. Nada de "líquido": é "faturamento recebido".

## 3. Dados novos (compatíveis com os antigos)

Tudo em `data/crm.json`, pelo mesmo arquivo atômico das notas e etiquetas:
`origens` (telefone para nome), `listaOrigens` (lista editável; sem ela vale a lista padrão),
`perdas` (telefone para motivo e data) e `followups` (telefone para lista de prazo e data).
Contato antigo sem esses campos continua igual: origem "sem origem", sem perda, sem follow-up.

## 4. Regras das pendências

1. Responder: a Carla está quieta esperando o Dr. Bruno.
2. Pagamento: reserva futura sem Pago.
3. Retorno de 3 ou 6 meses a avisar.
4. Pós-consulta: consulta realizada há 1 a 3 dias sem mensagem do consultório depois dela.
5. Follow-up de 7 dias: lead que parou há 7 a 29 dias e o consultório não escreveu depois.
6. Follow-up de 30 dias: o mesmo, parado há 30 a 60 dias. Passou de 60 dias, sai da lista do dia.
Quem está marcado como perdido, silenciado, paciente ou com consulta marcada não entra nos follow-ups.

## 5. Layout

Celular primeiro, com a mesma identidade (verde-escuro, dourado, vidro). Barra inferior de 5 itens
(Hoje, Famílias, Agenda, Números, Mais), busca de contato sempre no topo, tela Hoje com cartões
grandes tocáveis, botões de 44 px ou mais, texto de 14 px ou mais, área segura do iPhone.
No computador a barra vira uma faixa lateral e a ficha fica ao lado da lista.
