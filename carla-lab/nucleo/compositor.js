// Monta o system prompt da Carla a partir de dois dados separados:
//
//   perfil        → o consultório (preço, endereço, credenciais, dias de atendimento)
//   personalidade → como ela se comporta (uma versão = um conjunto ordenado de regras)
//
// É a peça que torna possível tudo o que vem depois: trocar de personalidade é trocar
// de versão, testar uma mudança é compor com outra versão, e ensinar a Carla é editar
// uma regra sem nunca abrir um prompt.

const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const DIR_REGRAS = path.join(RAIZ, "personalidade", "regras");

function lerPerfil(id = "dr-bruno") {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, "perfil", `${id}.json`), "utf8"));
}

function lerRegra(arquivo) {
  const bruto = fs.readFileSync(path.join(DIR_REGRAS, arquivo), "utf8");
  const fim = bruto.indexOf("\n---\n", 4);
  if (!bruto.startsWith("---\n") || fim === -1) {
    throw new Error(`regra sem cabeçalho válido: ${arquivo}`);
  }
  const meta = JSON.parse(bruto.slice(4, fim));
  // O texto vai até o fim do arquivo, menos a quebra final que o extrator escreve.
  const texto = bruto.slice(fim + 5).replace(/\n$/, "");
  return { ...meta, arquivo, texto };
}

// Uma versão de personalidade é sempre um delta sobre outra, nunca uma cópia inteira.
// Isso é o que faz voltar atrás ser barato: a versão anterior continua existindo
// intacta, e reverter é só apontar pra ela de novo.
function resolverHeranca(versao, vistas = []) {
  if (vistas.includes(versao)) {
    throw new Error(`herança circular de personalidade: ${[...vistas, versao].join(" -> ")}`);
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(RAIZ, "personalidade", `${versao}.json`), "utf8"));
  if (!cfg.derivadaDe) return { ...cfg, ajustes: cfg.ajustes || {}, linhagem: [versao] };

  const base = resolverHeranca(cfg.derivadaDe, [...vistas, versao]);
  return {
    ...base,
    ...cfg,
    ajustes: { ...base.ajustes, ...(cfg.ajustes || {}) },
    ordem: cfg.ordem || base.ordem,
    avisoPacienteConhecido: cfg.avisoPacienteConhecido || base.avisoPacienteConhecido,
    linhagem: [...base.linhagem, versao],
  };
}

function lerPersonalidade(versao = "v1") {
  const cfg = resolverHeranca(versao);
  const arquivos = fs.readdirSync(DIR_REGRAS).filter((f) => f.endsWith(".md"));
  const regras = arquivos.map(lerRegra);

  const porId = new Map();
  for (const r of regras) {
    if (r.variante) {
      if (!porId.has(r.id)) porId.set(r.id, { ...r, variantes: {} });
      porId.get(r.id).variantes[r.variante] = r.texto;
    } else {
      porId.set(r.id, r);
    }
  }

  for (const id of cfg.ordem) {
    if (!porId.has(id)) throw new Error(`a versão ${versao} pede a regra "${id}", que não existe`);
  }

  // Um ajuste nunca pode tocar numa regra marcada ajustavel:false. São as regras que
  // sustentam os invariantes (não afirmar agendamento sem a ferramenta, não opinar
  // clinicamente, conferir consulta existente, emergência). Se alguém tentar, para aqui
  // e não silenciosamente lá na frente, no meio de uma conversa com uma família.
  for (const [id, ajuste] of Object.entries(cfg.ajustes)) {
    const regra = porId.get(id);
    if (!regra) throw new Error(`ajuste aponta pra regra inexistente: "${id}"`);
    if (!regra.ajustavel) {
      throw new Error(`a regra "${id}" (${regra.titulo}) é um invariante e não aceita ajuste`);
    }
    if (ajuste.desligada) continue;
    if (typeof ajuste.texto !== "string") {
      throw new Error(`ajuste de "${id}" precisa de texto ou de desligada:true`);
    }
  }

  return { ...cfg, regras: porId };
}

function formatarData(now, nomesDiaSemana) {
  const p = (v) => String(v).padStart(2, "0");
  const diaSemana = (nomesDiaSemana || [])[now.getDay()] || "";
  return `${diaSemana}, ${p(now.getDate())}/${p(now.getMonth() + 1)}/${now.getFullYear()}, ${p(now.getHours())}:${p(now.getMinutes())}`;
}

function substituir(texto, valores) {
  return texto.replace(/\{\{(\w+)\}\}/g, (bruto, chave) => {
    if (!(chave in valores)) throw new Error(`marcador {{${chave}}} sem valor no perfil`);
    return valores[chave];
  });
}

// Monta o prompt. O resultado tem que ser idêntico ao de montarSystemPrompt() em
// produção — é isso que verificar-equivalencia.js confere a cada execução.
function montarPrompt({ now, pacienteConhecido = false, perfil, personalidade }) {
  const p = perfil || lerPerfil();
  const pers = personalidade || lerPersonalidade();

  const valores = {
    ...p,
    dataFormatada: formatarData(now, p.nomesDiaSemana),
    avisoPacienteConhecido: pacienteConhecido ? substituir(pers.avisoPacienteConhecido, p) : "",
  };

  const partes = [];
  for (const id of pers.ordem) {
    const ajuste = pers.ajustes[id];
    if (ajuste && ajuste.desligada) continue;

    const regra = pers.regras.get(id);
    const original = regra.variantes
      ? regra.variantes[pacienteConhecido ? "conhecido" : "novo"]
      : regra.texto;
    partes.push(substituir(ajuste ? ajuste.texto : original, valores));
  }

  return partes.join("\n\n");
}

module.exports = { lerPerfil, lerPersonalidade, lerRegra, montarPrompt, formatarData };
