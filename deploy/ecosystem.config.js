// PM2: mantém o Rota rodando e reinicia se cair ou se o servidor reiniciar.
//   pm2 start deploy/ecosystem.config.js && pm2 save
module.exports = {
  apps: [{
    name: 'rota',
    script: 'src/server.js',
    cwd: __dirname + '/..',
    env: {
      NODE_ENV: 'production',
      TZ: 'America/Sao_Paulo',
      NAVEGADOR_OCULTO: 'true',
      NAVEGADOR_CANAL: 'chromium',
    },
    max_memory_restart: '1200M',
    restart_delay: 10000,
    time: true,
  }],
};
