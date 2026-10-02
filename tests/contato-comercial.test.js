/*
 * Bateria: Contato comercial vai pra lista dele e sai do "Aguardando você".
 *
 * O dono (2026-10-02): "tem um monte de gente que manda mensagem pra mim com contato
 * comercial. Então aí não fica ali aguardando, entendeu? Vai pra uma outra listinha que você
 * cria ali de contatos comerciais."
 *
 * Roda com:  node tests/contato-comercial.test.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const Crm = require("../crm.js");

let passou = 0;
const erros = [];
function ok(cond, nome) { if (typeof nome !== "string") throw new Error("ok(cond, nome)"); if (cond) passou++; else erros.push(nome); }

const AGORA = new Date("2026-10-02T15:00:00Z");
const contato = (telefone, extra = {}) => ({ telefone, nome: null, ehPaciente: false, ultimaAtividade: "2026-10-02T14:00:00Z", ultimaMensagem: "Olá, sou representante", fechou: false, aguardandoHumano: true, silenciado: false, ...extra });

// ------------------------------------------------- 1. a lista nova existe
ok(Crm.SITUACOES.some((s) => s.chave === "comercial" && /comerciais/i.test(s.rotulo)), "1. existe a lista 'Contatos comerciais'");

// ------------------------------------------------- 2. marcado: só na lista dele
{
  const dadosCrm = { comerciais: { "+551": { em: "2026-10-02T14:30:00Z", silenciadoJunto: true } } };
  const r = Crm.montarCrm({ contatos: [contato("+551"), contato("+552")], dadosCrm, agora: AGORA });
  const rep = r.contatos.find((c) => c.telefone === "+551");
  const familia = r.contatos.find((c) => c.telefone === "+552");
  ok(rep.situacoes.length === 1 && rep.situacoes[0] === "comercial", "2. o comercial aparece SÓ na lista de Contatos comerciais");
  ok(!rep.situacoes.includes("aguardando_humano"), "2b. e sai do Aguardando você, que é o pedido");
  ok(!rep.situacoes.includes("lead"), "2c. e não conta como lead");
  ok(familia.situacoes.includes("aguardando_humano"), "2d. a família de verdade continua aguardando você");
  ok(r.contagem.aguardando_humano === 1 && r.contagem.comercial === 1, "2e. as contagens dos botões batem: 1 aguardando, 1 comercial");
  // Comparação com uma família SEM prioridade nenhuma e com conversa MAIS ANTIGA: sem o peso
  // do comercial, o representante (mais recente) viria na frente dela.
  const r2 = Crm.montarCrm({ contatos: [contato("+551"), contato("+553", { aguardandoHumano: false, ultimaAtividade: "2026-09-20T10:00:00Z" })], dadosCrm, agora: AGORA });
  ok(r2.contatos[r2.contatos.length - 1].telefone === "+551", "2f. comercial vai pro fim da lista, depois até da família mais parada");
  ok(rep.comercial && rep.comercial.em === "2026-10-02T14:30:00Z", "2g. a ficha sabe que é comercial (pro botão de desfazer)");
}

// ------------------------------------------------- 3. gravar e desfazer
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comercial-"));
  const arq = path.join(dir, "crm.json");
  const m = Crm.definirComercial(arq, "+551", true, { silenciadoJunto: true }, AGORA);
  ok(m.ok && m.comercial.silenciadoJunto === true, "3. marcar grava, lembrando se foi a marca que calou a Carla");
  const de2 = Crm.definirComercial(arq, "+551", true, { silenciadoJunto: false }, AGORA);
  ok(de2.comercial.silenciadoJunto === true, "3b. marcar de novo não esquece quem silenciou");
  const d = Crm.definirComercial(arq, "+551", false);
  ok(d.ok && d.comercial === null && d.anterior && d.anterior.silenciadoJunto, "3c. desfazer apaga e devolve o que era, pra rota saber se tira o silêncio");
  const lido = JSON.parse(fs.readFileSync(arq, "utf8"));
  ok(!lido.comerciais["+551"], "3d. e some do arquivo");
  ok(!Crm.definirComercial(arq, "", true).ok, "3e. sem telefone não grava");
  fs.rmSync(dir, { recursive: true, force: true });
}

// ------------------------------------------------- 4. a rota e o botão
{
  const PAINEL = fs.readFileSync(path.join(__dirname, "..", "painel-server.js"), "utf8");
  const rota = PAINEL.slice(PAINEL.indexOf('caminhoPedido === "/api/crm/comercial"'), PAINEL.indexOf('caminhoPedido === "/api/crm/followup"'));
  ok(/Storage\.retomarAtendimento\(telefone\)/.test(rota), "4. marcar tira o 'aguardando você' da conversa");
  ok(/if \(!Storage\.contatoSilenciado\(telefone\)\) \{ Storage\.silenciarContato\(telefone\); silenciadoJunto = true; \}/.test(rota), "4b. e cala a Carla, lembrando que foi a marca");
  ok(/if \(r\.ok && !marcar && r\.anterior && r\.anterior\.silenciadoJunto\) Storage\.dessilenciarContato\(telefone\);/.test(rota),
    "4c. desfazer só tira o silêncio que a própria marca pôs");
  const TELA = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");
  const acoes = TELA.slice(TELA.indexOf("<h3>Ações</h3>"), TELA.indexOf("const caixa = `"));
  ok(/btn-comercial-contato/.test(acoes) && /"Contato comercial"/.test(acoes), "4d. o botão está nas Ações da ficha");
  ok(/postJSON\("\/api\/crm\/comercial", \{ telefone: btn\.dataset\.telefone, comercial: marcar \}\)/.test(TELA), "4e. e chama a rota");
}

// ------------------------------------------------- 5. a ficha recebe a marca
{
  const recorte = Crm.recortarCrmDoTelefone({ comerciais: { "+551": { em: "x" }, "+559": { em: "y" } } }, "+551");
  ok(recorte.comerciais["+551"] && !recorte.comerciais["+559"], "5. a ficha recebe só a marca daquele número");
}

console.log(`contato-comercial: ${passou} passaram, ${erros.length} falharam`);
if (erros.length) { erros.forEach((e) => console.log("  x " + e)); process.exit(1); }
