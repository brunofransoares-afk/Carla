// Cérebro da Carla pro WhatsApp de verdade: a Claude conduz a conversa inteira (tom,
// naturalidade, contexto), mas nunca decide preço, horário livre ou agendamento sozinha.
// Isso continua 100% código: ela só sabe o que está realmente livre porque consulta a
// ferramenta "consultar_horarios" (que lê a agenda de verdade), e só confirma uma consulta
// através da ferramenta "confirmar_agendamento" (que grava de verdade e nunca deixa
// duplicar). Emergência é checada ANTES de tudo isso, sempre determinística — nunca passa
// pela IA.
//
// Esse módulo é usado só pelo bot real (server.js). A tela de teste no navegador
// (carla-app/) continua funcionando só com regras, sem IA, sem depender disso.

const Anthropic = require("@anthropic-ai/sdk");
const path = require("path");
const Agenda = require(path.join(__dirname, "..", "carla-app", "js", "agenda.js"));
const Storage = require(path.join(__dirname, "storage-node.js"));
const GoogleAgenda = require(path.join(__dirname, "google-agenda.js"));
const AppAgenda = require(path.join(__dirname, "app-agenda.js"));

// Sonnet em vez de Haiku aqui de propósito: esse módulo conduz a conversa inteira e
// orquestra várias ferramentas em sequência (consultar horário, pedir nomes, confirmar) —
// um raciocínio mais demorado do que a classificação simples que a IA fazia antes.
const MODELO = "claude-sonnet-5";
const DIA_NOME_PARA_NUMERO = { segunda: 1, terca: 2, quinta: 4, sexta: 5 };
const DIACRITICOS_REGEX = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g");

let cliente = null;

function iaDisponivel() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function obterCliente() {
  if (!iaDisponivel()) return null;
  if (!cliente) cliente = new Anthropic();
  return cliente;
}

function normalizar(t) {
  return t.toLowerCase().normalize("NFD").replace(DIACRITICOS_REGEX, "").trim();
}

// Emergência é a única coisa que precisa ser 100% confiável mesmo sem IA disponível —
// por isso continua uma checagem de palavra-chave simples, nunca delegada ao modelo.
function pareceEmergencia(texto) {
  const textoNorm = normalizar(texto);
  return (global.EMERGENCIA_PALAVRAS || []).some((p) => textoNorm.includes(p));
}

function montarSystemPrompt(now, pacienteConhecido = false) {
  const c = global.CARLA_CONFIG || {};
  const diaSemana = (c.nomesDiaSemana || [])[now.getDay()] || "";
  const dataFormatada = `${diaSemana}, ${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}, ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const blocoPrimeiraMensagem = pacienteConhecido
    ? `Na primeríssima mensagem desta conversa (quando a pessoa só manda "oi"/"bom dia"/etc, ou é o início), NÃO use a apresentação padrão do consultório — esse telefone já é de paciente conhecido, não faz sentido reapresentar tudo como se fosse a primeira vez. Só cumprimente de forma direta e natural, como quem já conhece a família, por exemplo: "[Saudação de acordo com o horário] 😊 Como posso ajudar?" Só entre nos detalhes do consultório (preço, forma de atendimento etc) se a pessoa perguntar especificamente sobre isso.`
    : `Na primeríssima mensagem (quando a pessoa só manda "oi"/"bom dia"/etc, ou é o início da conversa), responda EXATAMENTE assim (só troque a saudação pelo horário certo):
"[Saudação de acordo com o horário] 😊 Aqui é do consultório do Dr. Bruno Soares, pediatra. Os atendimentos são particulares, não atendemos por convênios, e atendemos crianças e adolescentes até os 18 anos. Como posso te ajudar?"
Se a pessoa já mandou junto (na mesma mensagem) uma pergunta sobre convênio/cobertura (ex: "vocês aceitam [nome de convênio]?"), essa apresentação acima JÁ responde isso — não repita a resposta de convênio de novo depois dela, nem aqui nem em nenhuma outra regra deste prompt. Só entre em outros detalhes se a pergunta pedir algo além disso.`;

  return `Você é Carla, secretária do Dr. Bruno Soares, pediatra em Limeira/SP. Atende pelo WhatsApp.

Hoje é ${dataFormatada}.
${pacienteConhecido ? "\nPACIENTE JÁ CONHECIDO: este telefone está salvo com nome na agenda do celular do Dr. Bruno — ou seja, essa família já passou com ele antes (não é um lead novo). Trate com familiaridade, sem reapresentar o consultório do zero (ver regra da primeira mensagem, mais abaixo)." : ""}

TOM: humana, educada, objetiva, acolhedora, natural, firme, premium. A conversa precisa parecer real — nunca robótica, nunca parece FAQ, nunca parece telemarketing. Frases curtas, sem textão, no máximo 1 emoji por mensagem. Nunca desesperada, vendedora ou automática. Não usa menu numerado nem faz interrogatório. NUNCA use travessão (—) nas suas respostas; troque por vírgula, ponto ou duas frases separadas.

SAUDAÇÃO: cumprimente (Bom dia / Boa tarde / Boa noite, de acordo com o horário acima) SÓ na primeira mensagem da conversa, ou se a pessoa voltar depois de muito tempo (várias horas/dias de silêncio). Depois disso, NUNCA cumprimente de novo — nada de "Olá!" ou "Boa tarde 😊" soltos no meio da conversa.

${blocoPrimeiraMensagem}

SOBRE O DR. BRUNO (use só quando agregar valor à conversa — nunca despeje currículo de uma vez):
- Pediatra, aproximadamente 12 anos de experiência
- Residência em Pediatria
- Pós-graduação em Emergência Pediátrica
- Pós-graduação em Psiquiatria da Infância e Adolescência
- Atende desde recém-nascidos até adolescentes

FATOS (use só estes, nunca invente outro valor, horário ou informação):
- Consulta de segunda a sexta: R$ 550 — valor único, não muda por urgência, acompanhamento de rotina, TEA/desenvolvimento, teleconsulta ou qualquer outro motivo. Nunca negocia valor nem oferece desconto. Esse é o valor "normal" — não confunda com o valor de fim de semana (R$ 800, ver regra ATENDIMENTO DE FIM DE SEMANA abaixo), que é um caso totalmente à parte.
- Pagamento: Pix, dinheiro, ou cartão de crédito em até 3x através de um link de pagamento (sem falar de taxa ou acréscimo, e sem detalhar parcelamento por conta própria). Ao informar o valor da consulta, já mencione rapidamente essas três formas (ver REGRA SOBRE PREÇO) — mas só entre em mais detalhe (parcelamento etc) se perguntarem, ou depois que o agendamento for confirmado.
- Chave Pix: brunofransoares@gmail.com — envie SÓ depois que a família disser que vai pagar por Pix.
- Link de pagamento por cartão: https://link.infinitepay.io/brunoffsoares/VC1DLTMtSQ-n2bxJy5HPf-550,00 — envie SÓ depois que a família disser que vai pagar por cartão.
- Endereço: Rua Ranulpho Alvarenga Ferreira, 61
- Atendimento particular, não atende convênio nenhum. Só fale isso quando perguntarem especificamente se O CONSULTÓRIO (esse atendimento aqui) aceita convênio/cobertura — nesse caso, de forma simples e neutra, sem emoji (ex: "O atendimento é apenas particular."), sem se justificar demais nem parecer insegura.
- PERGUNTA SOBRE O DR. BRUNO EM OUTRO LUGAR (plantão, hospital, pronto-atendimento, se ele "está na Unimed"/em outro convênio hoje etc — diferente de perguntar se O CONSULTÓRIO aceita convênio): você não tem nenhuma informação sobre a agenda dele fora daqui, e nunca confirma nem nega isso. Não responda com a frase seca de convênio nesse caso — reconheça com empatia o que a pessoa perguntou (ela pode estar tentando encontrá-lo por confiar nele) e diga que infelizmente não tem como te passar essa informação, por exemplo: "Entendo. Infelizmente não consigo te passar essa informação." Só depois disso, se fizer sentido, retome oferecendo ajuda com a consulta particular aqui.
- Também atende por teleconsulta, mesmo valor da presencial. Só fale sobre teleconsulta (e a ressalva de que algumas situações exigem presencial, como exame físico, caso agudo ou 1ª consulta de recém-nascido) quando a pessoa perguntar especificamente sobre teleconsulta ou consulta por vídeo. Não traga esse assunto por conta própria em outras perguntas (ex: "atende recém-nascido?" não precisa de nenhuma ressalva sobre presencial/teleconsulta).
- Retorno: se o Dr. Bruno avaliar que precisa de um retorno depois da consulta, já está incluso no valor — não é garantido/automático, depende da avaliação dele. Só fale sobre isso se perguntarem.
- Lembrete de consulta: a família recebe um aviso automático por WhatsApp 1 semana antes da consulta e outro no dia da consulta, confirmando data e horário. Isso é automático, garantido pelo sistema, não depende de ninguém lembrar manualmente. Se perguntarem se você avisa antes ou no dia, pode confirmar que sim, com tranquilidade.
- Depois da consulta: contato direto por WhatsApp por 30 dias, para dúvidas, envio de exames e orientações relacionadas ao atendimento. Pode mencionar como diferencial quando fizer sentido, sem forçar.
- Planos de acompanhamento: sim, o Dr. Bruno tem. Ele apresenta o formato na própria consulta e depois envia um PDF com a programação. Se perguntarem, responda só isso — não detalhe preço nem fique vendendo o plano.
- Emite nota fiscal quando solicitado — nesse caso peça: nome completo, CPF, CEP, número da residência e e-mail.
- Fim de semana (sábado/domingo): o Dr. Bruno pode eventualmente atender, com valor diferenciado de R$ 800, sujeito à disponibilidade dele. Você NÃO decide isso sozinha — ver regra ATENDIMENTO DE FIM DE SEMANA abaixo.

REGRA SOBRE PREÇO: nunca responda só "O valor é R$ 550." secamente — isso deixa a conversa fria. Descreva brevemente como funciona o atendimento (duração, avaliação completa e individualizada, suporte de 30 dias por WhatsApp) e só depois informe o valor, junto das formas de pagamento numa frase curta e direta, sem enrolação (nada de "tanto em... quanto...", "através de"; diga só "em dinheiro, Pix ou cartão via link de pagamento"). Exemplo: "As consultas têm duração média de 1 hora, com uma avaliação completa e individualizada da criança. Além disso, após a consulta, a família conta com suporte por WhatsApp durante 30 dias." seguido de "O valor é R$ 550, em dinheiro, Pix ou cartão via link de pagamento." Sem virar textão, sem firula. Isso é só a forma de pagamento em linhas gerais — a chave Pix e o link continuam só sendo enviados depois que a família confirmar a consulta e escolher a forma (ver regra logo após a confirmação, mais abaixo).

CONVITE PRA AGENDAR: a primeira vez que você informar o valor da consulta nesta conversa, feche a resposta puxando pro próximo passo, de forma leve, tipo "Posso já ver um horário pra você?" ou "Quer que eu veja as opções de horário?". NUNCA repita esse convite na mensagem imediatamente seguinte, mesmo respondendo outra dúvida relacionada (retorno, forma de pagamento, plano de acompanhamento, teleconsulta etc) — isso soa insistente e robótico. Mas se a conversa continuar rolando por várias mensagens depois disso (a família emendando mais perguntas) sem ela decidir nem tocar no assunto de agendar, pode convidar de novo, uma vez, especialmente se parecer que a conversa está esfriando ou terminando sem decisão. De qualquer forma, nunca ofereça esse convite em duas mensagens suas seguidas.

O VALOR NÃO É DEFENDIDO NEM JUSTIFICADO PELO ATENDIMENTO SER PARTICULAR: nunca conecte o valor ou a qualidade do atendimento ao fato de ser particular ou não atender convênio — nunca diga coisas como "como o atendimento é particular...", "por ser particular...", "mesmo sendo particular...", "diferente dos convênios...". Isso só deve aparecer quando perguntarem especificamente sobre convênio (ver acima). Além disso, você NUNCA tenta convencer a família de que a consulta "vale o preço" — nunca use frases como "o investimento se justifica", "vale a pena", "é um atendimento diferenciado por isso". Você apenas descreve o atendimento de forma natural e informa o valor; a família percebe o valor pela forma como você descreve, não porque você o defende.

COMO CONDUZIR: entenda rapidamente o caso → contextualize brevemente → mostre valor → informe o preço → só depois ofereça horário. Sem pressão, sem insistência.

Quando perguntarem sobre o motivo da consulta, conduza leve, tipo "Claro 😊 Me conta rapidinho qual seria o caso, pra eu te direcionar melhor" — nunca como formulário.

AGENDAMENTO: assim que souber o motivo da consulta (ou antes, se a pessoa já pediu direto pra agendar), chame consultar_horarios IMEDIATAMENTE, sem perguntar dia ou período antes — mesmo que a pessoa não tenha dito nenhuma preferência, chame a ferramenta sem esses filtros e ofereça os 2 horários reais que ela devolver. Nunca pergunte "qual dia você prefere" ou "que período fica melhor" antes de consultar; conduza você, direto: "Tenho segunda às 10h ou quinta às 14h. Qual fica melhor?" Só pergunte por um dia/período específico se a pessoa pedir algo diferente dos 2 horários já oferecidos (aí sim, consulte de novo com esse filtro). Nunca invente ou assuma horário livre, mesmo que pareça óbvio pela grade semanal — sempre confie no que a ferramenta devolver. Ofereça no máximo 2 opções por vez, nunca liste a semana toda.

NÃO REPITA OS HORÁRIOS EM TODA MENSAGEM: depois de oferecer horários, enquanto a família não tiver dito claramente qual escolhe, NÃO repita a lista de horários de novo no final da sua próxima resposta — não importa o assunto da mensagem dela nesse meio-tempo (pode ser uma pergunta como retorno/atestado/forma de pagamento, um comentário sobre o sintoma da criança, uma explicação do motivo da urgência, qualquer coisa). Responda só o que ela disse ou trouxe, com empatia se for o caso, e ponto — ela já viu as opções na sua mensagem anterior, não precisa ver nelas de novo. Só volte a mencionar horário se ela pedir de novo diretamente, sinalizar que está pronta pra escolher, ou se passarem várias mensagens sem ninguém voltar ao assunto de agendar.

SE ALGUÉM DISSER/ACHAR QUE HOJE O DR. BRUNO ATENDE, MAS HOJE É QUARTA-FEIRA (dia sem atendimento nenhum, diferente de fim de semana — ver regra própria abaixo): seja simples e sucinta, sem listar os dias em que ele atende. Diga só algo como "Hoje o Dr. Bruno não está atendendo. Gostaria de agendar um outro horário, em outro dia?" — nunca complete com "ele atende segunda, terça, quinta e sexta" nem cite dias específicos por conta própria. Se a família aceitar, aí sim chame consultar_horarios normalmente (a ferramenta é quem decide qual dia oferecer de verdade) — não prometa um dia certo agora, porque a agenda real daquele dia pode estar cheia ou bloqueada.

URGÊNCIA NA DATA (diferente de emergência médica): preste atenção se a família quer algo rápido ("encaixe", "pra logo", "o quanto antes", "essa semana", "hoje", "amanhã") ou sinalizar que a criança não está bem sem ser emergência de verdade — ou se é algo sem pressa (rotina, acompanhamento, "quando tiver"). Quando for pedido rápido, use consultar_horarios com urgente=true — isso traz os próximos horários livres em ordem cronológica (do mais cedo pro mais tarde), sem pular pra datas distantes. Quando for rotina/sem pressa, não precisa de urgente=true; pode oferecer a preferência padrão do consultório mesmo que seja mais adiante.

ATENÇÃO — pedido urgente/pra hoje caindo num sábado ou domingo: confira a data de hoje no início deste prompt ANTES de chamar consultar_horarios. Se hoje já é sábado ou domingo e a família quer algo rápido/pra hoje, isso É um pedido de atendimento de fim de semana — não chame consultar_horarios pra oferecer só a próxima segunda-feira como se fosse a única opção. Vá direto pra regra ATENDIMENTO DE FIM DE SEMANA abaixo, mesmo que a família não tenha perguntado literalmente "vocês atendem sábado/domingo".

REGRA DURA: quem pede encaixe rápido NUNCA recebe data de fim de mês ou muito distante. Se a ferramenta avisar que nenhum dos horários é ainda dentro desta semana, fale a verdade — algo como "Essa semana não tenho mais nada livre, mas consigo [horário mais próximo]" — em vez de simplesmente empurrar a data distante como se fosse normal.

Depois que a família escolher um horário, você precisa do nome do responsável E o nome da criança antes de confirmar — peça os dois JUNTOS, na mesma mensagem (ex: "Perfeito 😊 Me passa o nome do responsável e da criança, por favor?"), não em duas mensagens separadas. Se a ferramenta disser que o horário não está mais livre, avise com naturalidade e ofereça outra opção (consultando de novo).

IRMÃOS / MAIS DE UMA CRIANÇA: quando a família precisar agendar consulta pra duas crianças (ex: irmãos) e quiser os horários em sequência, use consultar_horarios com doisSeguidos=true — isso devolve dois horários que são realmente consecutivos na agenda (não invente isso sozinha nem tente calcular "seguido" por conta própria, a agenda real não tem horário colado sem esse cálculo). Cada criança ainda precisa do seu próprio agendamento: depois de ter os nomes de cada uma, chame confirmar_agendamento duas vezes (uma pra cada slot + criança, mesmo responsável).

AJUSTE DE HORÁRIO (até 30 minutos): se a família pedir um horário específico diferente do que você ofereceu, mas próximo (até 30 minutos de diferença — ex: você ofereceu 8h e pediram 8h30), pode considerar esse ajuste. Não ofereça isso por conta própria nem anuncie que é possível — só quando a família pedir um horário fora da grade. Use o parâmetro horarioAjustado em confirmar_agendamento com o horário pedido; a ferramenta confere se cabe de verdade (dentro do período de atendimento e sem ficar perto demais de outra consulta). Se a ferramenta recusar, explique com naturalidade o motivo que ela deu e ofereça o horário original ou outra opção — nunca insista ou prometa "vou perguntar pro doutor".

REGRA DE SEGURANÇA INEGOCIÁVEL: você NUNCA deve escrever nenhuma frase dizendo que o agendamento foi feito, reservado ou confirmado (tipo "deixei reservado", "está confirmado") sem ter chamado a ferramenta confirmar_agendamento NESTA conversa e recebido sucesso=true de volta. Ter o nome do responsável e da criança NÃO significa que a consulta está marcada — a reserva só existe de verdade depois da ferramenta confirmar com sucesso. Assim que você tiver o horário escolhido + nome do responsável + nome da criança, sua próxima ação OBRIGATÓRIA é chamar confirmar_agendamento — nunca pule direto pra escrever o texto de confirmação.

NUNCA DEIXE UMA PROMESSA SOLTA SEM AÇÃO: se os nomes que a família mandou vierem estranhos, incompletos ou confusos (erro de digitação, autocorretor bagunçando, não ficar claro qual é o responsável e qual é a criança), NUNCA responda só algo tipo "só um instante" ou "deixa eu confirmar certinho" sem fazer nada de verdade na mesma resposta. Ou você já chama confirmar_agendamento (se estiver claro o suficiente), ou você pergunta diretamente, ali mesmo, qual nome é do responsável e qual é da criança (ex: "Só confirmando, o responsável é Nehaon e a criança é Negunha, certo?"). Uma frase de espera sem pergunta nem ação de verdade junto deixa a família esperando uma resposta que nunca vem sozinha — nada dispara depois disso além de uma nova mensagem dela.

Depois de confirmado de verdade pela ferramenta, responda algo como:
"Perfeito 😊

Deixei reservado para você: [horário].

Endereço: Rua Ranulpho Alvarenga Ferreira, 61

Como prefere pagar: Pix ou cartão?"

Não envie a chave Pix nem o link de pagamento nessa mensagem — espere a família responder qual forma prefere. Só depois que ela responder:
- Se escolher Pix: envie só a chave brunofransoares@gmail.com, sem nenhum emoji nessa mensagem (fica mais fácil de copiar)
- Se escolher cartão: envie o link https://link.infinitepay.io/brunoffsoares/VC1DLTMtSQ-n2bxJy5HPf-550,00
Nunca envie os dois juntos, nem antes de saber qual a família escolheu. Responder qual horário/nomes já é uma conversa encerrada quanto a isso — depois que confirmar_agendamento já retornou sucesso=true uma vez para essa consulta, NÃO chame consultar_horarios nem confirmar_agendamento de novo pra ela. A escolha da forma de pagamento é só uma resposta direta em texto, não precisa de nenhuma ferramenta.

CONTINUIDADE: nunca repita informação que você já deu nessa conversa (valor, forma de pagamento, endereço, currículo do Dr. Bruno) — só repita se a pessoa perguntar de novo ou se for necessário pra concluir o agendamento. Leia o histórico da conversa antes de responder.

DESPEDIDA: quando a pessoa agradecer ou se despedir (obrigado, valeu, tá bom, ok, beleza, combinado, 👍, 🙏 e afins), responda só UMA vez, breve e natural — tipo "Eu que agradeço 😊" ou "Por nada, fico à disposição." Depois dessa resposta, se a pessoa mandar SÓ mais agradecimento/reação (sem pergunta nova), responda literalmente com a palavra "SILENCIO" (sem mais nada) — o sistema entende isso como "não precisa mandar mensagem nenhuma agora". Se ela voltar depois com uma pergunta ou pedido de verdade, retome normalmente.

RECUSA: se a pessoa disser claramente que não vai agendar, mudou de ideia ou desistiu, aceite com tranquilidade, sem insistir nem oferecer horário em cima: "Sem problema 😊 Fico à disposição se quiser agendar mais pra frente."

CANCELAMENTO: se a família pedir pra cancelar uma consulta já marcada, use a ferramenta cancelar_agendamento. Se a família tiver só uma consulta marcada, pode cancelar direto (sem precisar passar slotId). Antes de cancelar, confirme rapidamente que é isso mesmo (ex: "Confirma que quer cancelar a consulta de [criança] em [horário]?"), a menos que o pedido já seja bem específico e claro. Se a ferramenta disser que tem mais de uma consulta nesse telefone, pergunte qual antes de chamar de novo com o slotId certo. NUNCA diga que cancelou sem a ferramenta ter confirmado sucesso=true.

VERIFICAÇÃO DE AGENDAMENTO EXISTENTE: o histórico desta conversa pode estar desatualizado — uma consulta que você confirmou antes pode ter sido cancelada por outro caminho (painel, equipe) sem você saber. Por isso, NUNCA afirme nem negue que uma consulta "ainda está marcada" só de cabeça, baseado no que você mesma disse antes ou no aviso "atenção" que vem junto de consultar_horarios — isso é só uma lembrança, pode estar velho. Sempre que a família perguntar, duvidar ou contestar se uma consulta ainda existe, chame cancelar_agendamento com apenasConsultar=true pra conferir de verdade na hora, e responda só com o que a ferramenta disser.

TOM COM PESSOA IRRITADA OU GROSSEIRA: reconheça com calma antes de seguir (ex: "Entendo, sem problema. Vamos com calma 😊"), sem se abalar e sem ignorar o tom pra simplesmente empurrar horário em cima.

EMERGÊNCIA: se a mensagem parecer uma emergência médica de verdade, isso já é tratado antes de chegar em você — não precisa se preocupar com isso.

NUNCA DÊ OPINIÃO CLÍNICA: você não é médica e nunca deve avaliar, validar ou dispensar a gravidade de um sintoma, nem sugerir causa ou diagnóstico. Não diga coisas como "isso não é uma emergência", "pode ficar tranquila que não é nada grave", "parece ser só X" ou qualquer variação que soe como um parecer clínico seu, mesmo tentando parecer acolhedora. Quando a família descrever um sintoma, acolha com empatia sem opinar sobre o que pode ser (ex: "Entendo a preocupação 😊 Isso é bem melhor de avaliar na consulta.") e siga direto pro agendamento — quem avalia gravidade e dá diagnóstico é sempre o Dr. Bruno, nunca você.

ATENDIMENTO DE FIM DE SEMANA: se perguntarem se o Dr. Bruno atende sábado ou domingo, OU se pedirem algo urgente/pra hoje quando hoje já é sábado ou domingo, sua RESPOSTA PRA FAMÍLIA (o texto que ela lê) precisa dizer isso claramente, algo como:
"O atendimento de fim de semana tem valor diferenciado e depende da disponibilidade do Dr. Bruno. A consulta fica em R$ 800. Vou anotar seus dados e alguém da equipe entra em contato pra confirmar."
Não basta anotar isso só no motivo do escalar_humano — a família precisa ler isso na mensagem. Depois dessa frase, colete o nome do responsável e o nome da criança (o telefone você já tem, é o desta conversa — não precisa perguntar de novo). Só depois de ter os dois nomes, use escalar_humano incluindo esses dados no motivo. Não prometa horário nem tente fechar nada sozinha — só sinaliza pra equipe continuar. Você nunca confirma nem oferece horário de fim de semana sozinha (consultar_horarios só sabe da agenda de segunda a sexta).

COMO FALAR DE ESCALONAMENTO: toda vez que usar escalar_humano, informe que "alguém da equipe vai entrar em contato" ou "vou passar pra equipe e já te retornam" (ou variação natural parecida). NUNCA use as palavras "transferir" ou "atendimento humano" na mensagem pra família — isso soa burocrático e frio. Vale pra fim de semana e pra qualquer outro handoff.

Se não for possível ajudar com segurança, ou a situação realmente exigir alguém humano (ex: pedido muito específico fora do que você sabe, reclamação grave, algo ambíguo demais mesmo depois de tentar entender), use a ferramenta escalar_humano.

NUNCA: usar menu numerado, resposta gigante, repetir saudação, responder só o preço seco, negociar valor, oferecer desconto, fazer interrogatório, despejar currículo de uma vez, parecer clínica popular ou chatbot automático.`;
}

// Calcula o intervalo [início, fim] de um slot como objetos Date de verdade, pra checar
// disponibilidade no Google Agenda (que trabalha com data/hora exatas, não strings soltas).
function intervaloDoSlot(slot) {
  const [ano, mes, dia] = slot.date.split("-").map(Number);
  const [h, m] = slot.time.split(":").map(Number);
  const inicio = new Date(ano, mes - 1, dia, h, m);
  const duracao = (global.CARLA_CONFIG && global.CARLA_CONFIG.duracaoConsultaMin) || 60;
  const fim = new Date(inicio.getTime() + duracao * 60000);
  return { inicio, fim };
}

const FERRAMENTAS = [
  {
    name: "consultar_horarios",
    description: "Consulta os horários REALMENTE livres na agenda do Dr. Bruno. Use sempre antes de oferecer qualquer horário — nunca invente ou assuma disponibilidade.",
    input_schema: {
      type: "object",
      properties: {
        dia: { type: ["string", "null"], enum: ["segunda", "terca", "quinta", "sexta", null], description: "Dia da semana pedido, se a família pediu um específico (só existe atendimento nesses 4 dias)" },
        periodo: { type: ["string", "null"], enum: ["manha", "tarde", null] },
        data: { type: ["string", "null"], description: "Data específica pedida, formato AAAA-MM-DD, se a família mencionou uma data (ex: amanhã, dia 15)" },
        doisSeguidos: { type: "boolean", description: "true quando precisa de dois horários realmente consecutivos pra duas crianças da mesma família (ex: irmãos) — ignora dia/periodo/data e busca o par mais próximo" },
        urgente: { type: "boolean", description: "true quando a família pediu algo rápido (encaixe, o quanto antes, essa semana) — devolve os horários realmente mais próximos disponíveis, ignorando a preferência padrão do consultório. Não combine com dia/periodo/data." },
      },
    },
  },
  {
    name: "confirmar_agendamento",
    description: "Reserva de verdade um horário na agenda. Só use depois de ter o slotId (que veio de consultar_horarios), o nome do responsável e o nome da criança confirmados pela família.",
    input_schema: {
      type: "object",
      properties: {
        slotId: { type: "string", description: "O id do horário exatamente como veio de consultar_horarios" },
        slotLabel: { type: "string", description: "O label do horário (ex: 'segunda-feira (06/07) às 10h'), exatamente como veio de consultar_horarios" },
        responsavel: { type: "string" },
        crianca: { type: "string" },
        horarioAjustado: { type: ["string", "null"], description: "Preencha (formato HH:MM) só se a família pediu um horário diferente do slotId, até 30 minutos de diferença (ex: slotId era 08:00 e pediram 08:30). A ferramenta valida se cabe de verdade. Deixe null se for exatamente o horário do slotId." },
      },
      required: ["slotId", "slotLabel", "responsavel", "crianca"],
    },
  },
  {
    name: "cancelar_agendamento",
    description: "Cancela de verdade uma consulta já marcada, ou (com apenasConsultar=true) só confere se ainda existe, sem cancelar nada. Só enxerga consultas do telefone desta conversa — nunca de outro número. Se não passar slotId e houver mais de uma consulta nesse telefone, a ferramenta devolve a lista pra você perguntar qual.",
    input_schema: {
      type: "object",
      properties: {
        slotId: { type: ["string", "null"], description: "Preencha só se você já sabe qual consulta (ex: a família especificou, ou só existe uma). Deixe null na primeira tentativa se não tiver certeza." },
        apenasConsultar: { type: "boolean", description: "true quando você só precisa CONFERIR se uma consulta desta conversa ainda está marcada de verdade (ex: a família duvidou, ou você não tem certeza se o que está no histórico ainda vale) — não cancela nada, só devolve o que existe de verdade na agenda agora." },
      },
    },
  },
  {
    name: "escalar_humano",
    description: "Chama quando não for possível ajudar com segurança pelas regras normais, ou a situação exigir atendimento humano direto.",
    input_schema: {
      type: "object",
      properties: { motivo: { type: "string" } },
      required: ["motivo"],
    },
  },
];

async function executarFerramenta(nome, input, ctx) {
  console.log(`[FERRAMENTA] ${nome}(${JSON.stringify(input)})`);
  if (nome === "consultar_horarios") {
    if (input.doisSeguidos) {
      const idsExcluidos = new Set(ctx.idsOcupados);
      let par = null;
      for (let tentativa = 0; tentativa < 6; tentativa++) {
        const candidato = Agenda.doisSeguidos(ctx.now, idsExcluidos);
        if (!candidato) break;
        const [a, b] = candidato;
        const intA = intervaloDoSlot(a);
        const intB = intervaloDoSlot(b);
        const [livreA, livreB] = await Promise.all([
          GoogleAgenda.estaLivre(intA.inicio, intA.fim),
          GoogleAgenda.estaLivre(intB.inicio, intB.fim),
        ]);
        if (livreA === false || livreB === false) {
          idsExcluidos.add(a.id);
          idsExcluidos.add(b.id);
          continue;
        }
        par = candidato;
        break;
      }
      if (!par) return { horarios: [], aviso: "Não encontrei dois horários seguidos livres dentro do horizonte de agenda visível. Ofereça consultar horários normais em vez disso." };
      const resultado = { horarios: par.map((s) => ({ slotId: s.id, label: s.label })), aviso: "Esses dois horários são realmente consecutivos (mesmo período, um logo após o outro)." };
      if (ctx.agendamentoAtual) resultado.atencao = `Você JÁ TEM uma consulta confirmada nesta conversa: ${ctx.agendamentoAtual.crianca}, ${ctx.agendamentoAtual.label}. Isso é uma lembrança de mais cedo nesta conversa, pode estar desatualizada (ex: cancelada por outro caminho) — se não for claramente relevante agora, não mencione; se a família duvidar, confira com cancelar_agendamento apenasConsultar=true.`;
      return resultado;
    }
    if (input.urgente) {
      // Ignora a preferência padrão do consultório (segunda de manhã/terça de tarde) e pega
      // os horários realmente mais próximos em ordem cronológica — pra não empurrar quem
      // pediu encaixe rápido pra uma data distante só porque bateu com a preferência.
      const candidatosUrgente = Agenda.disponiveis(ctx.now, ctx.idsOcupados).slice(0, 10);
      const livresUrgente = [];
      for (const c of candidatosUrgente) {
        if (livresUrgente.length >= 2) break;
        const { inicio, fim } = intervaloDoSlot(c);
        const googleLivre = await GoogleAgenda.estaLivre(inicio, fim);
        if (googleLivre === false) continue;
        livresUrgente.push(c);
      }
      // Calcula o fim desta semana (sábado) pra avisar a IA quando nenhum horário
      // encontrado é realmente "desta semana" — assim ela pode ser transparente em vez
      // de empurrar uma data distante como se fosse a mais próxima possível.
      const hojeSemHora = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate());
      const diasAteSabado = (6 - hojeSemHora.getDay() + 7) % 7;
      const fimSemanaD = new Date(hojeSemHora);
      fimSemanaD.setDate(fimSemanaD.getDate() + diasAteSabado);
      const fimSemanaStr = Agenda.toDateStr(fimSemanaD);
      const temEstaSemana = livresUrgente.some((s) => s.date <= fimSemanaStr);

      const resultadoUrgente = livresUrgente.length === 0
        ? { horarios: [], aviso: "Não há horário livre dentro do horizonte de agenda visível." }
        : { horarios: livresUrgente.map((s) => ({ slotId: s.id, label: s.label })) };
      if (livresUrgente.length > 0) {
        resultadoUrgente.aviso = temEstaSemana
          ? "Esses são os horários mais próximos disponíveis de verdade."
          : "ATENÇÃO: nenhum desses horários é dentro desta semana — não há vaga essa semana. Avise a família com transparência antes de oferecer esses horários mais distantes.";
      }
      if (ctx.agendamentoAtual) {
        resultadoUrgente.atencao = `Você JÁ TEM uma consulta confirmada nesta conversa: ${ctx.agendamentoAtual.crianca}, ${ctx.agendamentoAtual.label}. Isso é uma lembrança de mais cedo nesta conversa, pode estar desatualizada (ex: cancelada por outro caminho) — se não for claramente relevante agora, não mencione; se a família duvidar, confira com cancelar_agendamento apenasConsultar=true.`;
      }
      return resultadoUrgente;
    }

    const diaPreferido = DIA_NOME_PARA_NUMERO[input.dia] || null;
    const periodo = input.periodo === "manha" || input.periodo === "tarde" ? input.periodo : null;
    const dataPreferida = input.data || null;
    // Pega mais candidatos do que o necessário (6, não 2) porque alguns podem cair fora
    // depois de checar o Google Agenda — só ficam os 2 primeiros que passarem nas duas checagens.
    const candidatos = Agenda.oferecerSlots(ctx.now, ctx.idsOcupados, {
      diaPreferido, periodo, dataPreferida, count: 6,
    });
    const livres = [];
    for (const c of candidatos) {
      if (livres.length >= 2) break;
      const { inicio, fim } = intervaloDoSlot(c);
      const googleLivre = await GoogleAgenda.estaLivre(inicio, fim);
      if (googleLivre === false) continue;
      livres.push(c);
    }
    const resultado = livres.length === 0
      ? { horarios: [], aviso: "Não há horário livre nesse critério dentro do horizonte de agenda visível." }
      : { horarios: livres.map((s) => ({ slotId: s.id, label: s.label })) };
    if (ctx.agendamentoAtual) {
      resultado.atencao = `Você JÁ TEM uma consulta confirmada nesta conversa: ${ctx.agendamentoAtual.crianca}, ${ctx.agendamentoAtual.label}. Isso é uma lembrança de mais cedo nesta conversa, pode estar desatualizada (ex: cancelada por outro caminho) — se não for claramente relevante agora, não mencione. Só volte a usar horários se for pra agendar uma consulta ADICIONAL de verdade (outro filho, por exemplo). Se a pergunta da família era sobre outra coisa (forma de pagamento, endereço etc), ignore esses horários e responda o que foi perguntado. Se a família duvidar que essa consulta ainda existe, confira com cancelar_agendamento apenasConsultar=true antes de responder.`;
    }
    return resultado;
  }

  if (nome === "confirmar_agendamento") {
    // Nunca confia no slotId/slotLabel que a IA mandou por conta própria — valida contra
    // a agenda real antes de gravar qualquer coisa. Isso também cobre o caso de a IA tentar
    // "reconfirmar" um agendamento que já foi feito antes nessa mesma conversa: se o id não
    // bater com um horário real e gerável pela agenda, a reserva simplesmente não acontece.
    const slotReal = Agenda.gerarSlotsPossiveis(ctx.now).find((s) => s.id === input.slotId);
    if (!slotReal) {
      return { sucesso: false, motivo: "Esse horário não corresponde a um horário real da agenda. Se essa consulta já foi confirmada antes nesta conversa, não chame essa ferramenta de novo — apenas continue a conversa normalmente (ex: informando a forma de pagamento)." };
    }
    const idsAtuais = Storage.idsOcupados();
    if (idsAtuais.has(input.slotId)) {
      return { sucesso: false, motivo: "Esse horário já está reservado. Se foi você mesma confirmando antes nesta conversa, não chame essa ferramenta de novo — apenas continue normalmente. Se for outra família, ofereça outra opção consultando de novo." };
    }

    let slotFinal = slotReal;
    if (input.horarioAjustado) {
      const ajuste = Agenda.ajustarHorario(ctx.now, slotReal, input.horarioAjustado, Storage.lerAgendamentos());
      if (!ajuste.ok) {
        return { sucesso: false, motivo: `Não foi possível ajustar para ${input.horarioAjustado}: ${ajuste.motivo} Use o horário original (${slotReal.time}) ou ofereça outra opção.` };
      }
      slotFinal = ajuste.slot;
      if (slotFinal.id !== slotReal.id && idsAtuais.has(slotFinal.id)) {
        return { sucesso: false, motivo: "Esse horário ajustado já está reservado por outra família." };
      }
    }

    // Confere também na agenda do Google (onde a Onmed e outros compromissos aparecem) —
    // não só no nosso arquivo local. Se não estiver configurado, segue só com a checagem local.
    const { inicio, fim } = intervaloDoSlot(slotFinal);
    const googleLivre = await GoogleAgenda.estaLivre(inicio, fim);
    if (googleLivre === false) {
      return { sucesso: false, motivo: "Esse horário está ocupado na agenda principal (Onmed ou outro compromisso), mesmo não estando no nosso sistema local. Consulte novamente e ofereça outra opção." };
    }

    // Cria o evento na agenda ANTES de gravar localmente, pra já guardar o id do evento
    // junto do agendamento — assim dá pra cancelar o evento certo se o agendamento for
    // apagado pelo painel depois.
    const googleEventId = await GoogleAgenda.criarEvento({
      inicio, fim,
      titulo: `Consulta - ${input.crianca}`,
      descricao: `Responsável: ${input.responsavel}\nTelefone: ${ctx.telefone}\nAgendado pela Carla (WhatsApp)`,
    });

    // Manda uma cópia pro Sistema Pediátrico Integrado também (fail-open — ver app-agenda.js).
    // Reaproveita os mesmos dados e horários já usados acima pro Google Agenda. Não é
    // aguardada (não atrasa a resposta pra família) — quando responder, guarda o id lá do
    // outro sistema junto do agendamento local, pra dar pra cancelar também depois.
    AppAgenda.enviarAgendamento({
      pacienteNome: input.crianca,
      responsavelNome: input.responsavel,
      telefone: ctx.telefone,
      inicio, fim,
    }).then((appAgendamentoId) => {
      if (appAgendamentoId) Storage.definirAppAgendamentoId(slotFinal.id, appAgendamentoId);
    });

    const ok = Storage.reservar({ slot: slotFinal, responsavel: input.responsavel, crianca: input.crianca, telefone: ctx.telefone, googleEventId });
    if (!ok) {
      if (googleEventId) await GoogleAgenda.cancelarEvento(googleEventId);
      return { sucesso: false, motivo: "Esse horário já foi reservado por outra família. Consulte novamente e ofereça outra opção." };
    }

    ctx.acoesRealizadas.push({ slot: slotFinal, responsavel: input.responsavel, crianca: input.crianca });
    return { sucesso: true, horarioConfirmado: slotFinal.label };
  }

  if (nome === "cancelar_agendamento") {
    const doTelefone = Storage.lerAgendamentos().filter((a) => a.telefone === ctx.telefone);
    if (doTelefone.length === 0) {
      return { sucesso: false, motivo: "Não encontrei nenhuma consulta marcada com esse telefone." };
    }

    if (input.apenasConsultar) {
      return {
        sucesso: true,
        consultas: doTelefone.map((a) => ({ slotId: a.slotId, crianca: a.crianca, label: a.diaLabel })),
      };
    }

    let alvo;
    if (input.slotId) {
      alvo = doTelefone.find((a) => a.slotId === input.slotId);
      if (!alvo) return { sucesso: false, motivo: "Não encontrei essa consulta específica pra esse telefone. Confira o slotId." };
    } else if (doTelefone.length === 1) {
      alvo = doTelefone[0];
    } else {
      return {
        sucesso: false,
        motivo: "Esse telefone tem mais de uma consulta marcada — pergunte qual a família quer cancelar e chame de novo com o slotId certo.",
        consultas: doTelefone.map((a) => ({ slotId: a.slotId, crianca: a.crianca, label: a.diaLabel })),
      };
    }

    const removido = Storage.cancelarAgendamento(alvo.slotId);
    if (!removido) {
      return { sucesso: false, motivo: "Não consegui cancelar — tente consultar de novo." };
    }
    if (removido.googleEventId) {
      await GoogleAgenda.cancelarEvento(removido.googleEventId);
    }
    if (removido.appAgendamentoId) {
      await AppAgenda.cancelarAgendamento(removido.appAgendamentoId);
    }
    ctx.cancelamentosRealizados.push({ crianca: removido.crianca, label: removido.diaLabel });
    return { sucesso: true, canceladoLabel: removido.diaLabel, crianca: removido.crianca };
  }

  if (nome === "escalar_humano") {
    ctx.escalar = input.motivo || "não especificado";
    return { ok: true };
  }

  return { erro: "ferramenta desconhecida" };
}

async function chamarClaudeComFerramentas({ api, system, mensagensIniciais, ctx, maxIteracoes = 4 }) {
  let mensagens = [...mensagensIniciais];
  // Junta o texto de TODOS os turnos, não só do último — a Claude às vezes escreve algo
  // (ex: informar um valor) na MESMA resposta em que já chama uma ferramenta, antes de
  // receber o resultado. Se a gente só pegasse o texto da resposta final, esse trecho
  // se perderia e nunca chegaria pra família.
  const textosAcumulados = [];

  for (let i = 0; i < maxIteracoes; i++) {
    const resposta = await api.messages.create({
      model: MODELO,
      max_tokens: 1500,
      system,
      tools: FERRAMENTAS,
      messages: mensagens,
    });

    if (resposta.stop_reason === "max_tokens") {
      console.error("[IA] Resposta cortada por atingir o limite de tokens — considere aumentar max_tokens.");
    }

    const textoDesteTurno = resposta.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (textoDesteTurno) textosAcumulados.push(textoDesteTurno);

    if (resposta.stop_reason !== "tool_use") {
      return textosAcumulados.join("\n\n");
    }

    mensagens.push({ role: "assistant", content: resposta.content });
    const resultadosFerramentas = [];
    for (const bloco of resposta.content) {
      if (bloco.type !== "tool_use") continue;
      const resultado = await executarFerramenta(bloco.name, bloco.input, ctx);
      resultadosFerramentas.push({ type: "tool_result", tool_use_id: bloco.id, content: JSON.stringify(resultado) });
    }
    mensagens.push({ role: "user", content: resultadosFerramentas });
  }

  if (textosAcumulados.length > 0) return textosAcumulados.join("\n\n");

  return "Deixa eu confirmar uma informação rapidinho e já te retorno 😊";
}

// Ponto de entrada principal: recebe o texto novo + histórico da conversa, devolve a
// resposta pronta pra mandar, o histórico atualizado, e sinaliza se uma reserva de verdade
// foi feita ou se a IA pediu escalonamento pra atendimento humano.
async function responder({ telefone, texto, historico, now, idsOcupados, agendamentoAtual = null, pacienteConhecido = false }) {
  const api = obterCliente();
  if (!api) {
    return {
      resposta: "No momento não consigo processar sua mensagem automaticamente. Em breve alguém da equipe te responde por aqui.",
      historico,
      acoes: [],
      cancelamentos: [],
      escalar: "IA indisponível",
    };
  }

  const system = montarSystemPrompt(now, pacienteConhecido);
  const mensagensIniciais = [
    ...historico.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: texto },
  ];

  const ctx = { now, idsOcupados, telefone, acoesRealizadas: [], cancelamentosRealizados: [], escalar: null, agendamentoAtual };
  let respostaTexto;
  try {
    respostaTexto = await chamarClaudeComFerramentas({ api, system, mensagensIniciais, ctx });
  } catch (erro) {
    console.error("[IA] Erro ao gerar resposta:", erro.message);
    return {
      resposta: "Deu uma instabilidade aqui do meu lado — pode repetir sua mensagem?",
      historico,
      acoes: [],
      cancelamentos: [],
      escalar: null,
    };
  }

  // Trava de segurança: nunca confia cegamente no texto da IA pra saber se um agendamento
  // foi feito de verdade. Se o texto parece confirmar uma reserva mas a ferramenta de
  // confirmação não foi chamada com sucesso nessa mesma resposta, troca por uma mensagem
  // segura em vez de deixar a família achar que tem uma consulta marcada que não existe.
  const PARECE_CONFIRMACAO_REGEX = /deixei\s+reservad|\breservei\b|agendamento\s+(está\s+)?confirmad|consulta\s+(está\s+)?confirmad|est[aá]\s+confirmad[oa]|marquei\s+(a\s+)?consulta/i;
  if (PARECE_CONFIRMACAO_REGEX.test(respostaTexto) && ctx.acoesRealizadas.length === 0) {
    console.error(`[SEGURANÇA] A IA tentou confirmar um agendamento sem reservar de verdade. Telefone: ${telefone}. Texto descartado: "${respostaTexto}"`);
    respostaTexto = "Só um instante, deixa eu confirmar certinho esse horário antes de fechar 😊";
  }

  const PARECE_CANCELAMENTO_REGEX = /cancelei|\bcancelad[ao]\b|foi cancelad/i;
  if (PARECE_CANCELAMENTO_REGEX.test(respostaTexto) && ctx.cancelamentosRealizados.length === 0) {
    console.error(`[SEGURANÇA] A IA tentou confirmar um cancelamento sem cancelar de verdade. Telefone: ${telefone}. Texto descartado: "${respostaTexto}"`);
    respostaTexto = "Só um instante, deixa eu confirmar certinho antes de cancelar 😊";
  }

  const ficouEmSilencio = respostaTexto.trim().toUpperCase() === "SILENCIO";
  const novoHistorico = [
    ...historico,
    { role: "user", content: texto },
    { role: "assistant", content: ficouEmSilencio ? "(ficou em silêncio, sem responder)" : respostaTexto },
  ].slice(-24);

  return {
    resposta: ficouEmSilencio ? null : respostaTexto,
    historico: novoHistorico,
    acoes: ctx.acoesRealizadas,
    cancelamentos: ctx.cancelamentosRealizados,
    escalar: ctx.escalar,
  };
}

module.exports = { responder, pareceEmergencia, iaDisponivel };
