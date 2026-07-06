// Configuração do PM2 no servidor Linux — sem o túnel Cloudflare (esse era só um jeito de
// expor o painel enquanto ele rodava num PC de casa sem IP público; aqui o servidor já tem
// IP público de verdade e nginx na frente, o painel fica acessível direto).
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
  ],
};
