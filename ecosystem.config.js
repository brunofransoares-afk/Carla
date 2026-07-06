// Configuração do PM2 — controla os processos da Carla de forma previsível,
// sem risco de subir duas instâncias brigando pela mesma conexão do WhatsApp.
module.exports = {
  apps: [
    {
      name: "carla-bot",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "10s",
      // Dá tempo do bot responder mensagens que estejam "na fila" (esperando debounce)
      // antes de ser desligado de verdade, pra reiniciar nunca perder mensagem de família.
      kill_timeout: 10000,
      out_file: "./logs/saida.log",
      error_file: "./logs/erro.log",
      time: true,
    },
    {
      // Painel separado do bot de propósito: precisa continuar de pé mesmo quando
      // o carla-bot estiver desligado, senão não teria como religar pela tela.
      name: "carla-painel",
      script: "painel-server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "10s",
      out_file: "./logs/painel-saida.log",
      error_file: "./logs/painel-erro.log",
      time: true,
    },
    {
      // Túnel público (Cloudflare) até o painel, pra acessar de fora de casa/da clínica.
      // O link atual (https://algo.trycloudflare.com) muda toda vez que reinicia — ver
      // "npm run logs:tunnel" pra descobrir o link vigente.
      name: "carla-tunnel",
      script: "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
      args: "tunnel --url http://localhost:3355",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "10s",
      out_file: "./logs/tunnel-saida.log",
      error_file: "./logs/tunnel-erro.log",
      time: true,
    },
  ],
};
