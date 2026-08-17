"use strict";

// Serializa tarefas da mesma chave sem impedir que chaves diferentes rodem em paralelo.
// No bot, a chave é o telefone: uma segunda mensagem da mesma família só começa depois que
// a primeira terminou de atualizar histórico, agenda e estado da conversa.
function criarFilaPorChave() {
  const caudas = new Map();

  function enfileirar(chave, tarefa) {
    if (typeof tarefa !== "function") {
      return Promise.reject(new TypeError("A tarefa da fila precisa ser uma função."));
    }

    const anterior = caudas.get(chave) || Promise.resolve();
    const execucao = anterior.then(() => tarefa());

    // A cauda nunca rejeita: uma falha precisa chegar a quem enfileirou aquela tarefa, mas
    // não pode bloquear para sempre as mensagens seguintes do mesmo telefone.
    const cauda = execucao.catch(() => {}).then(() => {
      if (caudas.get(chave) === cauda) caudas.delete(chave);
    });
    caudas.set(chave, cauda);

    return execucao;
  }

  return {
    enfileirar,
    quantidadeDeChaves: () => caudas.size,
    aguardarVazio: async () => {
      // Repete porque uma tarefa que estava rodando pode ter enfileirado outra antes de
      // terminar. As caudas não rejeitam, então o encerramento sempre consegue prosseguir.
      while (caudas.size > 0) await Promise.all([...caudas.values()]);
    },
  };
}

module.exports = { criarFilaPorChave };
