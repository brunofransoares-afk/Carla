// Service worker mínimo — existe só pra tornar o painel instalável como app no PC
// (Chrome e Edge só mostram o botão "Instalar" quando a página tem um service worker
// com handler de fetch). NÃO faz cache de nada de propósito: o painel mostra dados ao
// vivo (agendamentos, alertas, status), então tudo passa direto pra rede, sempre atual.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (evento) => evento.waitUntil(self.clients.claim()));
// Handler de fetch obrigatório pra ser instalável — como não chama respondWith, o
// navegador trata cada requisição normalmente (rede direta, sem cache).
self.addEventListener("fetch", () => {});
