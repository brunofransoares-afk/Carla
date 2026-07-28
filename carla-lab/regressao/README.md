# Suíte de regressão conversacional

A rede de segurança da Fase 0. Ela existe para responder uma pergunta só, sempre a mesma:
**a Carla continua se comportando como a Carla?**

Meses de ajuste de comportamento hoje vivem numa string sem nenhum teste. Qualquer edição
pode quebrar em silêncio uma regra afinada há semanas, e ninguém descobre até uma família
reclamar. Esta suíte transforma esse comportamento em algo que falha ruidosamente, antes
de chegar perto de um paciente.

## Formato de um caso

```json
{
  "id": "preco-nao-vem-seco",
  "titulo": "Preço nunca é informado sozinho",
  "regras": ["preco-como-informar", "convite-agendar"],
  "contexto": { "quando": "2026-07-27T09:05", "pacienteConhecido": false },
  "turnos": [
    {
      "usuario": "quanto custa a consulta?",
      "esperado": {
        "deveConter": ["550"],
        "naoDeveConter": ["vale a pena", "investimento"],
        "naoDeveChamar": ["confirmar_agendamento"]
      }
    }
  ]
}
```

| Campo | O que verifica |
|---|---|
| `deveConter` | trechos que precisam aparecer na resposta (sem acento e sem caixa) |
| `naoDeveConter` | trechos proibidos: é aqui que moram quase todas as regressões reais |
| `deveChamar` / `naoDeveChamar` | quais ferramentas a Carla acionou naquele turno |
| `respostaExata` | resposta literal, usado só no caso do `SILENCIO` |
| `maxCaracteres` | teto de tamanho, para pegar textão |

O campo `regras` liga o caso aos comportamentos de `personalidade/regras/`. É o que permite
medir cobertura: **todo comportamento precisa de pelo menos um caso**.

## Comandos

```bash
node carla-lab/regressao/verificar-cobertura.js   # roda sem chave de API
node carla-lab/regressao/executar.js              # roda a Carla de verdade (precisa de chave)
```

`verificar-cobertura.js` valida a integridade do corpus e cobra que os 41 comportamentos
estejam exercitados. Roda em qualquer lugar, inclusive em CI, e é o portão que impede a
suíte de apodrecer conforme regras novas forem criadas.

`executar.js` conversa de verdade com a Carla e confere as asserções. Precisa de
`ANTHROPIC_API_KEY` e do `carla-app/` presente, então roda no servidor ou no staging,
nunca aqui.

## Regra de uso

Um caso que falha significa uma de duas coisas, e vale parar para decidir qual:

1. **a mudança quebrou o comportamento** → reverter a mudança;
2. **o comportamento mudou de propósito** → atualizar o caso, no mesmo commit da mudança,
   com o motivo no texto do commit.

O que não vale é afrouxar a asserção para o teste passar. Esse é o caminho pelo qual toda
suíte de regressão morre.
