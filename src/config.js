// Lê o .env e decide o banco: SQL Server (PC), PostgreSQL (servidor) ou modo demo.
require('dotenv').config();

const demo = process.argv.includes('--demo') || !process.env.DB_SERVER;

// demo sem .env: chave de cofre temporária (os dados somem ao fechar de qualquer forma)
if (demo && !process.env.ROTA_CHAVE) process.env.ROTA_CHAVE = require('crypto').randomBytes(32).toString('base64');

const ambiente = {
  porta: Number(process.env.PORT) || 3000,
  demo,
  banco: {
    tipo: process.env.DB_TIPO === 'postgres' ? 'postgres' : 'sqlserver',
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT) || (process.env.DB_TIPO === 'postgres' ? 5432 : 1433),
    database: process.env.DB_DATABASE || 'Rota',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustCert: process.env.DB_TRUST_CERT !== 'false',
  },
};

// configurações ficam como texto no banco; aqui viram os tipos certos
const lista = (texto) => String(texto || '').split(/[;\n]/).map((s) => s.trim()).filter(Boolean);

function lerConfiguracoes(bruto) {
  return {
    modoTeste: bruto.modo_teste !== 'false',
    notaMinima: Number(bruto.nota_minima ?? 70),
    janelaInicio: bruto.janela_inicio || '08:00',
    janelaFim: bruto.janela_fim || '22:00',
    termosBusca: lista(bruto.termos_busca),
    termosExcluir: lista(bruto.termos_excluir),
    localizacao: bruto.localizacao || '',
    modelosAceitos: lista(bruto.modelos_aceitos).map((m) => m.toLowerCase()),
    incluirAfirmativas: bruto.incluir_afirmativas === 'true',
    // sem nada salvo: só estágio
    aceitaJunior: /junior/.test(String(bruto.niveis_aceitos || 'estagio')),
    incluirSuporte: bruto.incluir_suporte === 'true',
    maxCandidatos: Number(bruto.max_candidatos ?? 100) || 0,  // 0 = sem limite
    maxDias: Number(bruto.max_dias ?? 2),
    velocidade: bruto.velocidade === 'humana' ? 'humana' : 'rapida',
  };
}

module.exports = { ambiente, lerConfiguracoes };
