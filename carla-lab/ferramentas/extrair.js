// Ferramenta de extração (roda uma vez, mas fica versionada pra auditoria).
//
// Pega o prompt que está em produção hoje e o quebra em duas coisas:
//   perfil/        → o que é do consultório do Dr. Bruno (preço, endereço, credenciais)
//   personalidade/ → como a Carla se comporta (tom, cadência, o que ela nunca faz)
//
// Nada aqui inventa texto. Cada pedaço sai literal do prompt real; a única mudança é
// trocar os valores do consultório por marcadores {{assim}}. O compositor faz o caminho
// de volta, e verificar-equivalencia.js prova que o resultado é idêntico byte a byte.

const fs = require("fs");
const path = require("path");
const ref = require("../nucleo/prompt-referencia.js");

const RAIZ = path.join(__dirname, "..");
const DIR_REGRAS = path.join(RAIZ, "personalidade", "regras");

// Valores do consultório que viram campo editável. Ordem importa: as trocas mais longas
// vêm primeiro pra não corromper as curtas (o link do cartão contém o preço "550").
const SUBSTITUICOES = [
  ["https://link.infinitepay.io/brunoffsoares/VC1DLTMtSQ-n2bxJy5HPf-550,00", "{{linkCartao}}"],
  ["Rua Ranulpho Alvarenga Ferreira, 61", "{{endereco}}"],
  ["brunofransoares@gmail.com", "{{chavePix}}"],
  ["segunda, terça, quinta e sexta", "{{diasDeAtendimento}}"],
  ["Dr. Bruno Soares", "{{profissional}}"],
  ["Dr. Bruno", "{{profissionalCurto}}"],
  ["Limeira/SP", "{{cidade}}"],
  ["QUARTA-FEIRA", "{{diaSemAtendimentoMaiuscula}}"],
  ["quarta-feira", "{{diaSemAtendimento}}"],
  ["R$ 550", "{{preco}}"],
  ["R$ 800", "{{precoFimDeSemana}}"],
];

const PERFIL = {
  id: "dr-bruno",
  nome: "Consultório Dr. Bruno Soares",
  observacao:
    "Valores extraídos do prompt em produção (cerebro-ia.js). nomesDiaSemana é o único campo que NÃO pôde ser conferido: ele vive em carla-app/js/config.js, que não está versionado. Conferir no VPS antes de confiar.",
  assistente: "Carla",
  profissional: "Dr. Bruno Soares",
  profissionalCurto: "Dr. Bruno",
  especialidade: "pediatra",
  cidade: "Limeira/SP",
  preco: "R$ 550",
  precoFimDeSemana: "R$ 800",
  chavePix: "brunofransoares@gmail.com",
  linkCartao: "https://link.infinitepay.io/brunoffsoares/VC1DLTMtSQ-n2bxJy5HPf-550,00",
  endereco: "Rua Ranulpho Alvarenga Ferreira, 61",
  diasDeAtendimento: "segunda, terça, quinta e sexta",
  diaSemAtendimento: "quarta-feira",
  diaSemAtendimentoMaiuscula: "QUARTA-FEIRA",
  nomesDiaSemana: [
    "domingo",
    "segunda-feira",
    "terça-feira",
    "quarta-feira",
    "quinta-feira",
    "sexta-feira",
    "sábado",
  ],
};

// Cada entrada: [índices do bloco original, id, título que o médico vê, categoria,
// ajustável pelo painel?, explicação em português claro].
//
// ajustavel:false marca as regras que sustentam os invariantes da Carla. O módulo
// "Ensine a Carla" mostra essas regras, mas não deixa editar nem desligar: se elas
// caírem, a Carla passa a poder afirmar coisas que não aconteceram.
const MAPA = [
  [[0], "identidade", "Quem a Carla é", "identidade", false,
   "A frase de abertura do prompt: nome, quem ela atende e por onde. Muda junto com o perfil do consultório."],
  [[1], "contexto-de-agora", "Data e hora atuais", "sistema", false,
   "Informa à Carla que dia e hora são agora, e se o telefone já é de uma família conhecida. Preenchido pelo sistema a cada mensagem."],
  [[2], "tom", "Tom de voz", "tom", true,
   "Como a Carla soa: frases curtas, no máximo um emoji, nada de textão, nada de travessão."],
  [[3], "saudacao", "Quando cumprimentar", "tom", true,
   "Cumprimenta só na primeira mensagem, ou se a família sumir por muito tempo. Desejar boa tarde ao se despedir continua liberado."],
  [[4], "primeira-mensagem", "Mensagem de abertura", "abertura", true,
   "A estrutura da primeira resposta: saudação, quem ela é, aviso de particular como cortesia e uma pergunta aberta. Tem duas versões: família nova e família que já é paciente."],
  [[5], "sobre-o-profissional", "Currículo do médico", "identidade", true,
   "O que a Carla pode dizer sobre a formação do médico, e o aviso de nunca despejar tudo de uma vez."],
  [[6], "fatos", "Fatos do consultório", "conhecimento", true,
   "A base de conhecimento: preço, formas de pagamento, endereço, teleconsulta, retorno, lembretes, planos. A Carla só pode usar o que está aqui."],
  [[7], "preco-como-informar", "Como falar o preço", "dinheiro", true,
   "Nunca soltar o valor seco. Descrever o atendimento primeiro, depois o valor e as formas de pagamento numa frase curta."],
  [[8], "convite-agendar", "Convite pra agendar", "agendamento", true,
   "Depois de informar o preço, ela puxa pro próximo passo uma vez. Não repete na mensagem seguinte, e nunca em duas mensagens seguidas."],
  [[9], "valor-nao-se-defende", "Não justificar o preço", "dinheiro", true,
   "Ela nunca liga o valor ao fato de ser particular, e nunca tenta convencer que a consulta vale o preço."],
  [[10], "como-conduzir", "Ordem da conversa", "agendamento", true,
   "Entender o caso, contextualizar, mostrar valor, informar preço e só então oferecer horário."],
  [[11], "motivo-da-consulta", "Perguntar o motivo", "agendamento", true,
   "Pergunta o motivo de forma leve, nunca como formulário."],
  [[12], "agendamento", "Como oferecer horários", "agendamento", true,
   "Consulta a agenda de verdade assim que sabe o motivo, oferece no máximo duas opções e nunca pergunta o dia preferido antes."],
  [[13], "nao-repetir-horarios", "Não repetir os horários", "agendamento", true,
   "Depois de oferecer horários, não repete a lista em toda mensagem enquanto a família não escolher."],
  [[14], "dia-sem-atendimento", "Dia fechado da semana", "agendamento", true,
   "Quando alguém acha que há atendimento no dia fechado, ela responde curto e sem listar os dias em que o médico atende."],
  [[15], "urgencia-na-data", "Pedido de encaixe", "agendamento", true,
   "Reconhece quando a família quer algo rápido e busca os horários mais próximos, em vez da preferência padrão."],
  [[16], "urgente-no-fim-de-semana", "Urgência caindo no fim de semana", "agendamento", true,
   "Se hoje já é sábado ou domingo e pedem algo pra hoje, isso é atendimento de fim de semana, não a próxima segunda."],
  [[17], "encaixe-sem-data-distante", "Encaixe nunca vira data distante", "agendamento", true,
   "Quem pede encaixe não recebe data de fim de mês. Se não houver nada na semana, ela fala a verdade."],
  [[18], "coleta-de-nomes", "Pedir os nomes", "agendamento", true,
   "Pede o nome do responsável e o da criança juntos, na mesma mensagem."],
  [[19], "irmaos", "Duas crianças em sequência", "agendamento", true,
   "Usa a agenda pra achar dois horários realmente consecutivos e confirma um agendamento pra cada criança."],
  [[20], "ajuste-de-horario", "Ajuste de até 30 minutos", "agendamento", true,
   "Se a família pede um horário próximo do oferecido, a ferramenta confere se cabe. Ela nunca oferece isso por conta própria."],
  [[21], "seguranca-confirmacao", "Nunca dizer que marcou sem ter marcado", "segurança", false,
   "Ela só pode escrever que a consulta está reservada depois que a ferramenta confirmar de verdade. Este é o invariante que impede a Carla de inventar um agendamento."],
  [[22], "promessa-sem-acao", "Nunca prometer sem agir", "segurança", false,
   "Proíbe respostas como \"só um instante\" sem pergunta nem ação junto, que deixam a família esperando algo que nunca vem."],
  [[23, 24, 25, 26], "mensagem-pos-confirmacao", "Mensagem depois de confirmar", "agendamento", true,
   "O formato da mensagem de confirmação: horário reservado, endereço e a pergunta sobre forma de pagamento."],
  [[27], "envio-dos-dados-de-pagamento", "Quando enviar Pix ou link", "dinheiro", true,
   "Só manda a chave ou o link depois que a família disser qual prefere, e nunca os dois juntos."],
  [[28], "continuidade", "Não repetir o que já disse", "tom", true,
   "Ela lê o histórico antes de responder e não repete valor, endereço ou currículo já ditos."],
  [[29], "despedida", "Como se despedir", "encerramento", true,
   "Agradece de volta, se coloca à disposição sem insistir e fecha com um desejo bom."],
  [[30], "despedida-por-contexto", "Despedida conforme o desfecho", "encerramento", true,
   "A despedida muda se a família agendou, se só tirou dúvida, ou se foi embora sem agendar."],
  [[31], "despedida-exemplos", "Exemplos de despedida", "encerramento", true,
   "Referências de tom que ela nunca deve copiar ao pé da letra."],
  [[32], "silencio", "Quando não responder nada", "encerramento", true,
   "Se a família só manda mais um agradecimento depois da despedida, o sistema não envia mensagem nenhuma."],
  [[33], "recusa", "Quando desistem", "encerramento", true,
   "Aceita a desistência com tranquilidade, sem insistir nem oferecer horário em cima."],
  [[34], "cancelamento", "Cancelar consulta", "agendamento", true,
   "Confirma antes de cancelar e nunca diz que cancelou sem a ferramenta ter confirmado."],
  [[35], "verificar-agendamento", "Conferir se a consulta existe", "segurança", false,
   "O histórico pode estar velho: uma consulta pode ter sido cancelada pelo painel. Ela sempre confere na hora em vez de responder de memória."],
  [[36], "pessoa-irritada", "Família irritada", "tom", true,
   "Reconhece o incômodo com calma antes de seguir, sem se abalar e sem empurrar horário por cima."],
  [[37], "emergencia", "Emergência médica", "segurança", false,
   "Emergência é detectada por palavra-chave antes de a IA ver a mensagem. Esta regra só avisa a Carla de que isso já foi tratado."],
  [[38], "sem-opiniao-clinica", "Nunca opinar sobre sintoma", "segurança", false,
   "Ela nunca avalia, valida ou descarta a gravidade de um sintoma, nem sugere causa ou diagnóstico. Quem avalia é o médico."],
  [[39], "fim-de-semana", "Atendimento de fim de semana", "agendamento", true,
   "Valor diferenciado e sujeito à disponibilidade. Ela informa, coleta os nomes e passa pra equipe, sem prometer horário."],
  [[40], "como-falar-de-escalonamento", "Como passar pra equipe", "tom", true,
   "Diz \"alguém da equipe entra em contato\", nunca \"transferir\" ou \"atendimento humano\"."],
  [[41], "quando-escalar", "Quando chamar alguém", "segurança", true,
   "Pedido muito específico, reclamação grave ou algo ambíguo demais vai pra equipe."],
  [[42], "contato-comercial", "Representante ou convite", "triagem", true,
   "Contato comercial não é atendimento: ela responde uma vez, avisa o médico e para de interagir."],
  [[43], "nunca", "Lista do que nunca fazer", "tom", true,
   "O fecho do prompt: menu numerado, textão, saudação repetida, preço seco, negociar valor, interrogatório."],
];

function aplicarMarcadores(texto) {
  let saida = texto;
  for (const [valor, marcador] of SUBSTITUICOES) saida = saida.split(valor).join(marcador);
  return saida;
}

function frontmatter(meta) {
  return `---\n${JSON.stringify(meta, null, 2)}\n---\n`;
}

function main() {
  const fonte = ref.carregarFonte();
  const template = ref.extrairTemplate(fonte);
  const primeira = ref.extrairBlocosPrimeiraMensagem(fonte);

  const blocos = template.split("\n\n");
  if (blocos.length !== 44) {
    throw new Error(`esperava 44 blocos no prompt, achei ${blocos.length} — o prompt mudou, revise o MAPA`);
  }

  const cobertos = new Set();
  for (const [indices] of MAPA) for (const i of indices) {
    if (cobertos.has(i)) throw new Error(`bloco ${i} mapeado duas vezes`);
    cobertos.add(i);
  }
  for (let i = 0; i < blocos.length; i++) {
    if (!cobertos.has(i)) throw new Error(`bloco ${i} não foi mapeado pra nenhuma regra`);
  }

  fs.rmSync(DIR_REGRAS, { recursive: true, force: true });
  fs.mkdirSync(DIR_REGRAS, { recursive: true });

  const ordem = [];
  let n = 0;

  for (const [indices, id, titulo, categoria, ajustavel, explicacao] of MAPA) {
    n += 1;
    const prefixo = String(n).padStart(2, "0");
    const meta = { id, titulo, categoria, ajustavel, explicacao };
    ordem.push(id);

    if (id === "primeira-mensagem") {
      // Único bloco com duas versões: o prompt escolhe uma delas em tempo de execução.
      meta.variantes = ["novo", "conhecido"];
      fs.writeFileSync(
        path.join(DIR_REGRAS, `${prefixo}-${id}.novo.md`),
        frontmatter({ ...meta, variante: "novo" }) + aplicarMarcadores(primeira.novo) + "\n",
      );
      fs.writeFileSync(
        path.join(DIR_REGRAS, `${prefixo}-${id}.conhecido.md`),
        frontmatter({ ...meta, variante: "conhecido" }) + aplicarMarcadores(primeira.conhecido) + "\n",
      );
      continue;
    }

    let texto = indices.map((i) => blocos[i]).join("\n\n");

    // O bloco de contexto carrega duas interpolações do código original. Vira marcador
    // pra que o compositor preencha do mesmo jeito.
    if (id === "contexto-de-agora") {
      texto = "Hoje é {{dataFormatada}}.\n{{avisoPacienteConhecido}}";
    }

    fs.writeFileSync(
      path.join(DIR_REGRAS, `${prefixo}-${id}.md`),
      frontmatter(meta) + aplicarMarcadores(texto) + "\n",
    );
  }

  // O aviso de paciente conhecido também é texto do consultório, não do sistema.
  const avisoConhecido = aplicarMarcadores(
    "\nPACIENTE JÁ CONHECIDO: este telefone está salvo com nome na agenda do celular do {{profissionalCurto}} — ou seja, essa família já passou com ele antes (não é um lead novo). Trate com familiaridade, sem reapresentar o consultório do zero (ver regra da primeira mensagem, mais abaixo).",
  );

  fs.writeFileSync(
    path.join(RAIZ, "perfil", "dr-bruno.json"),
    JSON.stringify(PERFIL, null, 2) + "\n",
  );

  fs.writeFileSync(
    path.join(RAIZ, "personalidade", "v1.json"),
    JSON.stringify(
      {
        versao: "v1",
        descricao: "Extração fiel do prompt em produção, sem nenhuma alteração de comportamento.",
        derivadaDe: null,
        avisoPacienteConhecido: avisoConhecido,
        ordem,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`perfil: 1 arquivo`);
  console.log(`personalidade: ${ordem.length} regras (${fs.readdirSync(DIR_REGRAS).length} arquivos)`);
}

main();
