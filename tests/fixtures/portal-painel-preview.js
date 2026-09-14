"use strict";
// Prévia local com famílias fictícias: NÃO carrega server.js, não usa credenciais,
// não chama IA, não abre WhatsApp. Todos os POSTs são simulados e ficam só em memória.
// Rodar: node tests/fixtures/portal-painel-preview.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const Crm = require("../../crm.js");
const Avisos = require("../../avisos-texto.js");
const raiz = path.join(__dirname, "../..");
const tel = "+16195550123", outro = "+5519000000002";
const contatos = [
  { telefone: tel, nome: "Família de teste — consulta por fora", ehPaciente: true, ultimaAtividade: new Date().toISOString(), ultimaMensagem: "Obrigada pela consulta!" },
  { telefone: outro, nome: "Outra família de teste", ehPaciente: true },
];
const consulta = { id: "manual-teste", telefone: tel, data: "2026-09-10", crianca: "Criança fictícia", tipoConsulta: "puericultura", modalidade: "presencial", estado: "realizada", horario: "10:00" };
const dadosCrm = { notas: {}, etiquetas: {}, retornos: {}, consultasRealizadas: { [tel]: [consulta] } };
const endereco = "https://portal.example.test";
const enviados = new Set();
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const json = (obj, status = 200) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
  const crm = Crm.montarCrm({ contatos, agendamentos: [], funilContatos: [], dadosCrm });
  if (url.pathname === "/api/crm") return json({ ...crm, temLinkAvaliacao: false });
  if (url.pathname === "/api/crm/contato") {
    const telefone = url.searchParams.get("telefone");
    const contato = crm.contatos.find(c => c.telefone === telefone);
    if (!contato) return json({ ok: false, erro: "Contato fictício não encontrado" }, 404);
    return json({ ok: true, telefone, contato, consultas: telefone === tel ? [consulta] : [], notas: [], etiquetas: [], historico: [], linhaDoTempo: [], modelos: Crm.modelosPara({}),
      portal: { disponivel: true, emailSugerido: telefone === tel ? "mae@example.test" : "outra@example.test", modelo: Avisos.textoPortal({ endereco, email: "{{EMAIL_RESPONSAVEL}}" }) } });
  }
  if (url.pathname === "/api/portal-manual" && req.method === "POST") {
    let corpo = "";
    for await (const parte of req) { corpo += parte; if (corpo.length > 4096) return json({ ok: false }, 413); }
    let dados;
    try { dados = JSON.parse(corpo); } catch { return json({ ok: false }, 400); }
    const valido = Avisos.prepararPortalManual({ ...dados, endereco });
    if (!valido.ok) return json(valido, 422);
    const chave = dados.telefone + ":" + dados.email;
    const jaAvisado = enviados.has(chave);
    enviados.add(chave);
    return json({ ok: true, jaAvisado, pendente: !jaAvisado });
  }
  if (url.pathname === "/api/dados") return json({ agendamentos: [], alertas: [], bloqueios: [], contatos, silenciados: [], metricas: {} });
  if (url.pathname === "/api/status") return json({ rodando: false, conectado: false, estado: "desligado" });
  if (url.pathname === "/api/funil") return json({ etapas: [], contatos: [], conversaoParticular: { base: 0, fecharam: 0, taxa: 0 } });
  if (url.pathname.startsWith("/api/")) return json({ ok: false, motivo: "Ação não habilitada nesta prévia fictícia." }, 404);
  const arquivo = url.pathname === "/" ? "dashboard.html" : url.pathname.slice(1);
  const permitido = ["dashboard.html", "manifest.json", "sw.js", "fontes/montserrat.woff2", "icons/favicon-32x32.png", "icons/favicon-16x16.png", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png"];
  if (!permitido.includes(arquivo) || !fs.existsSync(path.join(raiz, arquivo))) { res.writeHead(404); return res.end(); }
  const tipo = arquivo.endsWith("html") ? "text/html; charset=utf-8" : arquivo.endsWith("json") ? "application/json" : arquivo.endsWith("js") ? "application/javascript" : arquivo.endsWith("woff2") ? "font/woff2" : "image/png";
  res.writeHead(200, { "Content-Type": tipo, "Cache-Control": "no-store" });
  res.end(fs.readFileSync(path.join(raiz, arquivo)));
}).listen(13355, "127.0.0.1", () => console.log("Prévia fictícia disponível em http://127.0.0.1:13355 — nenhum envio real."));
