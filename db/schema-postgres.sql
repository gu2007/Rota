-- Esquema do Rota para PostgreSQL (usado no servidor). Equivale ao db/schema.sql (SQL Server)
-- com todas as migrações aplicadas. Idempotente: pode rodar de novo sem apagar nada.
-- Datas e horas em UTC (TIMESTAMPTZ).

CREATE TABLE IF NOT EXISTS perfil (
  id                INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nome              VARCHAR(120),
  email             VARCHAR(160),
  telefone          VARCHAR(30),
  cidade            VARCHAR(80),
  linkedin_url      VARCHAR(300),
  github_url        VARCHAR(300),
  portfolio_url     VARCHAR(300),
  objetivo          VARCHAR(500),
  resumo            TEXT,
  curriculo_arquivo VARCHAR(300),
  foto_arquivo      VARCHAR(300),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS formacoes (
  id SERIAL PRIMARY KEY, curso VARCHAR(160) NOT NULL, instituicao VARCHAR(160), nivel VARCHAR(60),
  status VARCHAR(60), inicio VARCHAR(20), fim VARCHAR(20)
);
CREATE TABLE IF NOT EXISTS experiencias (
  id SERIAL PRIMARY KEY, cargo VARCHAR(160) NOT NULL, empresa VARCHAR(160), inicio VARCHAR(20), fim VARCHAR(20), descricao TEXT
);
CREATE TABLE IF NOT EXISTS projetos (
  id SERIAL PRIMARY KEY, nome VARCHAR(160) NOT NULL, descricao TEXT, tecnologias VARCHAR(300), repo_url VARCHAR(300), demo_url VARCHAR(300)
);
CREATE TABLE IF NOT EXISTS cursos (
  id SERIAL PRIMARY KEY, nome VARCHAR(160) NOT NULL, instituicao VARCHAR(160), carga_horaria INT, concluido_em VARCHAR(20)
);
CREATE TABLE IF NOT EXISTS habilidades (id SERIAL PRIMARY KEY, nome VARCHAR(80) NOT NULL, nivel VARCHAR(30));
CREATE TABLE IF NOT EXISTS textos (id SERIAL PRIMARY KEY, titulo VARCHAR(160) NOT NULL, texto TEXT);

CREATE TABLE IF NOT EXISTS respostas_fixas (
  chave VARCHAR(60) PRIMARY KEY, rotulo VARCHAR(160) NOT NULL, ajuda VARCHAR(300), resposta VARCHAR(500), ordem INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS configuracoes (chave VARCHAR(60) PRIMARY KEY, valor VARCHAR(1000));

CREATE TABLE IF NOT EXISTS plataformas (
  codigo        VARCHAR(30) PRIMARY KEY,
  nome          VARCHAR(80) NOT NULL,
  tipo          VARCHAR(20) NOT NULL CHECK (tipo IN ('coleta', 'candidatura')),
  ativa         BOOLEAN NOT NULL DEFAULT TRUE,
  limite_diario INT NOT NULL DEFAULT 20,
  pausada_ate   TIMESTAMPTZ,
  motivo_pausa  VARCHAR(300),
  ordem         INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vagas (
  id                SERIAL PRIMARY KEY,
  url               VARCHAR(1000) NOT NULL UNIQUE,   -- a mesma vaga nunca entra duas vezes
  url_candidatura   VARCHAR(1000),
  origem_plataforma VARCHAR(30) NOT NULL,
  origem_coleta     VARCHAR(20) NOT NULL,
  plataforma_envio  VARCHAR(30),
  titulo            VARCHAR(200) NOT NULL,
  empresa           VARCHAR(160),
  local             VARCHAR(120),
  modelo            VARCHAR(30),
  descricao         TEXT,
  nota              INT,
  justificativa     VARCHAR(1000),
  status            VARCHAR(20) NOT NULL DEFAULT 'nova'
                    CHECK (status IN ('nova','na_fila','descartada','candidatada','testada','pulada','erro','aguardando','para_voce')),
  motivo_status     VARCHAR(300),
  coletada_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_vagas_fila ON vagas (status, plataforma_envio, nota);
CREATE INDEX IF NOT EXISTS ix_vagas_url_candidatura ON vagas (url_candidatura);

CREATE TABLE IF NOT EXISTS candidaturas (
  id         SERIAL PRIMARY KEY,
  vaga_id    INT NOT NULL REFERENCES vagas (id),
  plataforma VARCHAR(30) NOT NULL,
  resultado  VARCHAR(20) NOT NULL CHECK (resultado IN ('enviada','simulada','pulada','erro','captcha')),
  modo_teste BOOLEAN NOT NULL DEFAULT FALSE,
  motivo     VARCHAR(500),
  respostas  TEXT,   -- JSON
  criada_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agenda (
  id           SERIAL PRIMARY KEY,
  data         DATE NOT NULL,          -- dia local (São Paulo)
  plataforma   VARCHAR(30) NOT NULL,
  horario      TIMESTAMPTZ NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','executado','perdido','ignorado')),
  resultado    VARCHAR(40),
  executado_em TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_agenda_data ON agenda (data, plataforma, status);

CREATE TABLE IF NOT EXISTS eventos (
  id        BIGSERIAL PRIMARY KEY,
  nivel     VARCHAR(10) NOT NULL,
  origem    VARCHAR(40) NOT NULL,
  mensagem  VARCHAR(1000) NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- cofre: valores cifrados pela aplicação (AES-256-GCM)
CREATE TABLE IF NOT EXISTS dados_pessoais (
  chave         VARCHAR(60) PRIMARY KEY,
  valor_cifrado TEXT NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS perguntas (
  id            SERIAL PRIMARY KEY,
  chave         VARCHAR(400) NOT NULL UNIQUE,
  pergunta      VARCHAR(1000) NOT NULL,
  tipo          VARCHAR(20),
  opcoes        TEXT,   -- JSON
  resposta      TEXT,
  vagas         TEXT,   -- JSON
  vezes         INT NOT NULL DEFAULT 1,
  criada_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  respondida_em TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS processos (
  id               SERIAL PRIMARY KEY,
  email_id         VARCHAR(400) NOT NULL UNIQUE,
  vaga_id          INT,
  empresa          VARCHAR(160),
  vaga_titulo      VARCHAR(200),
  situacao         VARCHAR(30) NOT NULL,
  resumo           VARCHAR(1000),
  acao             VARCHAR(500),
  prazo            VARCHAR(40),
  assunto          VARCHAR(300),
  recebido_em      TIMESTAMPTZ NOT NULL,
  notificado       BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  link             VARCHAR(1000),
  prazo_data       DATE,
  prazo_hora       VARCHAR(5),
  lembrete_enviado BOOLEAN NOT NULL DEFAULT FALSE
);
