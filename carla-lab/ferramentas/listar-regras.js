// O catálogo que o módulo "Ensine a Carla" vai mostrar pro médico.
//
// A ideia do módulo é essa: o médico nunca vê prompt. Ele vê uma lista de
// comportamentos com nome e explicação em português, e mexe naquilo que é dele pra
// mexer. O que está travado aparece igual, com o motivo — esconder invariante só faz
// alguém tentar contorná-lo.
//
//   node carla-lab/ferramentas/listar-regras.js [versao]

const { lerPersonalidade } = require("../nucleo/compositor.js");

const CATEGORIAS = {
  identidade: "Identidade",
  sistema: "Preenchido pelo sistema",
  tom: "Jeito de falar",
  abertura: "Abertura da conversa",
  conhecimento: "O que ela sabe",
  dinheiro: "Preço e pagamento",
  agendamento: "Agendamento",
  encerramento: "Fim da conversa",
  triagem: "Triagem",
  segurança: "Travadas (não editáveis)",
};

function main() {
  const versao = process.argv[2] || "v1";
  const pers = lerPersonalidade(versao);

  const porCategoria = new Map();
  for (const id of pers.ordem) {
    const regra = pers.regras.get(id);
    if (!porCategoria.has(regra.categoria)) porCategoria.set(regra.categoria, []);
    porCategoria.get(regra.categoria).push(regra);
  }

  console.log(`\nPersonalidade ${pers.versao}  ·  linhagem: ${pers.linhagem.join(" -> ")}`);
  console.log(`${pers.descricao}\n`);

  for (const [chave, titulo] of Object.entries(CATEGORIAS)) {
    const regras = porCategoria.get(chave);
    if (!regras) continue;

    console.log(`${titulo.toUpperCase()}`);
    for (const regra of regras) {
      const ajuste = pers.ajustes[regra.id];
      let marca = regra.ajustavel ? "   " : " * ";
      if (ajuste) marca = ajuste.desligada ? " - " : " ~ ";

      console.log(`${marca}${regra.titulo}`);
      console.log(`      ${regra.explicacao}`);
      if (ajuste) console.log(`      >> ${ajuste.desligada ? "desligada" : "ajustada"}: ${ajuste.motivo || "sem motivo registrado"}`);
    }
    console.log("");
  }

  const travadas = pers.ordem.filter((id) => !pers.regras.get(id).ajustavel).length;
  const mexidas = Object.keys(pers.ajustes).length;
  console.log(`${pers.ordem.length} comportamentos  ·  ${travadas} travados (*)  ·  ${mexidas} alterados nesta versão (~ ajustado, - desligado)\n`);
}

main();
