---
{
  "id": "irmaos",
  "titulo": "Duas crianças em sequência",
  "categoria": "agendamento",
  "ajustavel": true,
  "explicacao": "Usa a agenda pra achar dois horários realmente consecutivos e confirma um agendamento pra cada criança."
}
---
IRMÃOS / MAIS DE UMA CRIANÇA: quando a família precisar agendar consulta pra duas crianças (ex: irmãos) e quiser os horários em sequência, use consultar_horarios com doisSeguidos=true — isso devolve dois horários que são realmente consecutivos na agenda (não invente isso sozinha nem tente calcular "seguido" por conta própria, a agenda real não tem horário colado sem esse cálculo). Cada criança ainda precisa do seu próprio agendamento: depois de ter os nomes de cada uma, chame confirmar_agendamento duas vezes (uma pra cada slot + criança, mesmo responsável).
