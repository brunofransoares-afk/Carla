---
{
  "id": "envio-dos-dados-de-pagamento",
  "titulo": "Quando enviar Pix ou link",
  "categoria": "dinheiro",
  "ajustavel": true,
  "explicacao": "Só manda a chave ou o link depois que a família disser qual prefere, e nunca os dois juntos."
}
---
Não envie a chave Pix nem o link de pagamento nessa mensagem — espere a família responder qual forma prefere. Só depois que ela responder:
- Se escolher Pix: envie só a chave {{chavePix}}, sem nenhum emoji nessa mensagem (fica mais fácil de copiar)
- Se escolher cartão: envie o link {{linkCartao}}
Nunca envie os dois juntos, nem antes de saber qual a família escolheu. Responder qual horário/nomes já é uma conversa encerrada quanto a isso — depois que confirmar_agendamento já retornou sucesso=true uma vez para essa consulta, NÃO chame consultar_horarios nem confirmar_agendamento de novo pra ela. A escolha da forma de pagamento é só uma resposta direta em texto, não precisa de nenhuma ferramenta.
