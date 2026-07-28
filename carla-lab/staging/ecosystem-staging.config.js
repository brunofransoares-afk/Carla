// Configuração do PM2 para o ambiente de STAGING.
//
// Sobe uma segunda Carla ao lado da que atende o consultório, sem encostar nela: outra
// pasta, outros dados, outro número de WhatsApp, outra agenda.
//
// A regra de ouro do staging é uma só: NENHUM efeito colateral pode alcançar uma pessoa
// de verdade. Nem mensagem, nem evento no Google Agenda, nem aviso pro médico. Um teste
// que manda WhatsApp pra uma família é pior do que não testar.
//
// Só o bot está aqui. O painel NÃO sobe em staging: a porta dele é fixa no código
// (painel-server.js:17, `const PORTA = 3355`), então uma segunda instância brigaria com a
// de produção pela mesma porta. Tornar a porta configurável é uma mudança de uma linha,
// compatível com o comportamento atual, mas mexe em arquivo de produção e por isso não
// foi feita nesta fase. Veja README.md.
//
// Uso, no servidor:
//   cd /root/carla-staging
//   pm2 start carla-lab/staging/ecosystem-staging.config.js
module.exports = {
  apps: [
    {
      name: "carla-staging-bot",
      script: "server.js",
      cwd: __dirname + "/../..",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 10000,
      out_file: "./logs/staging-saida.log",
      error_file: "./logs/staging-erro.log",
      time: true,
      env: {
        // Agenda separada. Nunca o GOOGLE_CALENDAR_ID de produção: um teste de
        // agendamento criaria um evento de verdade na agenda do médico.
        GOOGLE_CALENDAR_ID: "PREENCHER_COM_CALENDARIO_DE_TESTE",

        // Aviso de novo agendamento apontando pro seu número de teste, nunca pro
        // número real, senão cada caso da suíte vira uma notificação no celular dele.
        DR_BRUNO_TELEFONE: "PREENCHER_COM_SEU_NUMERO_DE_TESTE",

        // Espelhamento no prontuário desligado. Sem estas variáveis o app-agenda.js
        // não envia nada: ele já trata ausência de configuração falhando em silêncio.
        APP_SUPABASE_URL: "",
        APP_SERVICE_ROLE_KEY: "",
        APP_OWNER_ID: "",

        // A chave da IA é a mesma, mas o consumo do staging aparece na mesma fatura.
        // Rodar a suíte inteira gasta de verdade: ver a estimativa no README.
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },
    },
  ],
};
