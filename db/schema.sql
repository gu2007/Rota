-- =============================================================
-- Rota · schema do banco (SQL Server)
-- Idempotente: pode rodar várias vezes sem apagar dados.
-- Os blocos são separados por GO (o script init-db.js divide por eles).
-- Todas as datas/horas são gravadas em UTC.
-- =============================================================

-- ---------- Seu perfil (uma linha só) ----------
IF OBJECT_ID('dbo.perfil') IS NULL
CREATE TABLE dbo.perfil (
  id                INT            NOT NULL CONSTRAINT pk_perfil PRIMARY KEY DEFAULT 1,
  nome              NVARCHAR(120)  NULL,
  email             NVARCHAR(160)  NULL,
  telefone          NVARCHAR(30)   NULL,
  cidade            NVARCHAR(80)   NULL,
  linkedin_url      NVARCHAR(300)  NULL,
  github_url        NVARCHAR(300)  NULL,
  portfolio_url     NVARCHAR(300)  NULL,
  objetivo          NVARCHAR(500)  NULL,
  resumo            NVARCHAR(MAX)  NULL,
  curriculo_arquivo NVARCHAR(300)  NULL,
  atualizado_em     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT ck_perfil_unico CHECK (id = 1)
);
GO

-- ---------- Listas do perfil ----------
IF OBJECT_ID('dbo.formacoes') IS NULL
CREATE TABLE dbo.formacoes (
  id          INT IDENTITY PRIMARY KEY,
  curso       NVARCHAR(160) NOT NULL,
  instituicao NVARCHAR(160) NULL,
  nivel       NVARCHAR(60)  NULL,   -- Graduação, Técnico...
  status      NVARCHAR(60)  NULL,   -- Em andamento, Concluído
  inicio      NVARCHAR(20)  NULL,   -- texto livre: 02/2026, 01/02/2026...
  fim         NVARCHAR(20)  NULL
);
GO

IF OBJECT_ID('dbo.experiencias') IS NULL
CREATE TABLE dbo.experiencias (
  id        INT IDENTITY PRIMARY KEY,
  cargo     NVARCHAR(160) NOT NULL,
  empresa   NVARCHAR(160) NULL,
  inicio    NVARCHAR(20)  NULL,
  fim       NVARCHAR(20)  NULL,
  descricao NVARCHAR(MAX) NULL
);
GO

IF OBJECT_ID('dbo.projetos') IS NULL
CREATE TABLE dbo.projetos (
  id          INT IDENTITY PRIMARY KEY,
  nome        NVARCHAR(160) NOT NULL,
  descricao   NVARCHAR(MAX) NULL,
  tecnologias NVARCHAR(300) NULL,
  repo_url    NVARCHAR(300) NULL,
  demo_url    NVARCHAR(300) NULL
);
GO

IF OBJECT_ID('dbo.cursos') IS NULL
CREATE TABLE dbo.cursos (
  id            INT IDENTITY PRIMARY KEY,
  nome          NVARCHAR(160) NOT NULL,
  instituicao   NVARCHAR(160) NULL,
  carga_horaria INT           NULL,
  concluido_em  NVARCHAR(20)  NULL
);
GO

IF OBJECT_ID('dbo.habilidades') IS NULL
CREATE TABLE dbo.habilidades (
  id    INT IDENTITY PRIMARY KEY,
  nome  NVARCHAR(80) NOT NULL,
  nivel NVARCHAR(30) NULL
);
GO

-- ---------- Respostas fixas (a IA nunca inventa estas) ----------
IF OBJECT_ID('dbo.respostas_fixas') IS NULL
CREATE TABLE dbo.respostas_fixas (
  chave    NVARCHAR(60)  NOT NULL PRIMARY KEY,
  rotulo   NVARCHAR(160) NOT NULL,
  ajuda    NVARCHAR(300) NULL,
  resposta NVARCHAR(500) NULL,
  ordem    INT           NOT NULL DEFAULT 0
);
GO

-- ---------- Configurações gerais (chave/valor) ----------
IF OBJECT_ID('dbo.configuracoes') IS NULL
CREATE TABLE dbo.configuracoes (
  chave NVARCHAR(60)   NOT NULL PRIMARY KEY,
  valor NVARCHAR(1000) NULL
);
GO

-- ---------- Plataformas e limites diários ----------
-- tipo 'coleta'      = onde o bot PROCURA vagas (LinkedIn, e-mail, Google)
-- tipo 'candidatura' = onde o bot SE CANDIDATA (Gupy, InfoJobs, sites)
IF OBJECT_ID('dbo.plataformas') IS NULL
CREATE TABLE dbo.plataformas (
  codigo        NVARCHAR(30)  NOT NULL PRIMARY KEY,
  nome          NVARCHAR(80)  NOT NULL,
  tipo          NVARCHAR(20)  NOT NULL CONSTRAINT ck_plataforma_tipo CHECK (tipo IN ('coleta','candidatura')),
  ativa         BIT           NOT NULL DEFAULT 1,
  limite_diario INT           NOT NULL DEFAULT 20,
  pausada_ate   DATETIME2     NULL,
  motivo_pausa  NVARCHAR(300) NULL,
  ordem         INT           NOT NULL DEFAULT 0
);
GO

-- ---------- Vagas encontradas ----------
IF OBJECT_ID('dbo.vagas') IS NULL
CREATE TABLE dbo.vagas (
  id                INT IDENTITY PRIMARY KEY,
  url               NVARCHAR(1000) NOT NULL,
  -- hash da URL: garante que a mesma vaga nunca entra duas vezes
  url_hash          AS CAST(HASHBYTES('SHA2_256', url) AS BINARY(32)) PERSISTED,
  url_candidatura   NVARCHAR(1000) NULL,
  origem_plataforma NVARCHAR(30)   NOT NULL,  -- onde foi achada: linkedin, infojobs, google...
  origem_coleta     NVARCHAR(20)   NOT NULL,  -- email | site | busca | manual
  plataforma_envio  NVARCHAR(30)   NULL,      -- onde a candidatura acontece: gupy, infojobs, sites
  titulo            NVARCHAR(200)  NOT NULL,
  empresa           NVARCHAR(160)  NULL,
  local             NVARCHAR(120)  NULL,
  modelo            NVARCHAR(30)   NULL,      -- presencial | hibrido | remoto
  descricao         NVARCHAR(MAX)  NULL,
  nota              INT            NULL,      -- 0 a 100
  justificativa     NVARCHAR(1000) NULL,
  status            NVARCHAR(20)   NOT NULL DEFAULT 'nova',
  motivo_status     NVARCHAR(300)  NULL,
  coletada_em       DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT ck_vaga_status CHECK (status IN ('nova','na_fila','descartada','candidatada','testada','pulada','erro','aguardando','para_voce'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_vagas_url_hash')
CREATE UNIQUE INDEX ux_vagas_url_hash ON dbo.vagas(url_hash);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_vagas_fila')
CREATE INDEX ix_vagas_fila ON dbo.vagas(status, plataforma_envio, nota);
GO

-- ---------- Histórico de candidaturas ----------
IF OBJECT_ID('dbo.candidaturas') IS NULL
CREATE TABLE dbo.candidaturas (
  id         INT IDENTITY PRIMARY KEY,
  vaga_id    INT           NOT NULL CONSTRAINT fk_cand_vaga REFERENCES dbo.vagas(id),
  plataforma NVARCHAR(30)  NOT NULL,
  resultado  NVARCHAR(20)  NOT NULL CONSTRAINT ck_cand_resultado CHECK (resultado IN ('enviada','simulada','pulada','erro','captcha')),
  modo_teste BIT           NOT NULL DEFAULT 0,
  motivo     NVARCHAR(500) NULL,
  respostas  NVARCHAR(MAX) NULL,  -- JSON: [{ "pergunta": "...", "resposta": "...", "fonte": "fixa|perfil|ia" }]
  criada_em  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- ---------- Agenda do dia (horários sorteados) ----------
IF OBJECT_ID('dbo.agenda') IS NULL
CREATE TABLE dbo.agenda (
  id           INT IDENTITY PRIMARY KEY,
  data         DATE          NOT NULL,  -- dia local (São Paulo)
  plataforma   NVARCHAR(30)  NOT NULL,
  horario      DATETIME2     NOT NULL,  -- UTC
  status       NVARCHAR(20)  NOT NULL DEFAULT 'pendente'
               CONSTRAINT ck_agenda_status CHECK (status IN ('pendente','executado','perdido','ignorado')),
  resultado    NVARCHAR(40)  NULL,
  executado_em DATETIME2     NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_agenda_data')
CREATE INDEX ix_agenda_data ON dbo.agenda(data, plataforma, status);
GO

-- ---------- Log de eventos ----------
IF OBJECT_ID('dbo.eventos') IS NULL
CREATE TABLE dbo.eventos (
  id        BIGINT IDENTITY PRIMARY KEY,
  nivel     NVARCHAR(10)   NOT NULL,  -- info | aviso | erro
  origem    NVARCHAR(40)   NOT NULL,
  mensagem  NVARCHAR(1000) NOT NULL,
  criado_em DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- =============================================================
-- MIGRAÇÕES: ajustes em tabelas que já existiam.
-- Cada bloco confere antes de alterar, então rodar de novo não faz nada.
-- =============================================================

-- 001 · campos de data aceitavam só 7 caracteres (2026-02). Agora 20 (01/02/2026).
-- COL_LENGTH devolve bytes: NVARCHAR(7) = 14 bytes, NVARCHAR(20) = 40 bytes.
IF COL_LENGTH('dbo.formacoes', 'inicio') < 40 ALTER TABLE dbo.formacoes ALTER COLUMN inicio NVARCHAR(20) NULL;
IF COL_LENGTH('dbo.formacoes', 'fim') < 40 ALTER TABLE dbo.formacoes ALTER COLUMN fim NVARCHAR(20) NULL;
IF COL_LENGTH('dbo.experiencias', 'inicio') < 40 ALTER TABLE dbo.experiencias ALTER COLUMN inicio NVARCHAR(20) NULL;
IF COL_LENGTH('dbo.experiencias', 'fim') < 40 ALTER TABLE dbo.experiencias ALTER COLUMN fim NVARCHAR(20) NULL;
IF COL_LENGTH('dbo.cursos', 'concluido_em') < 40 ALTER TABLE dbo.cursos ALTER COLUMN concluido_em NVARCHAR(20) NULL;
GO

-- 002 · cofre de dados pessoais (valores criptografados com AES-256-GCM pela aplicação)
IF OBJECT_ID('dbo.dados_pessoais') IS NULL
CREATE TABLE dbo.dados_pessoais (
  chave          NVARCHAR(60)  NOT NULL PRIMARY KEY,
  valor_cifrado  NVARCHAR(MAX) NOT NULL,   -- "iv:tag:conteudo" em base64. Sem a ROTA_CHAVE é ilegível.
  atualizado_em  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- 003 · textos escritos por você (trajetória, motivação...) que a IA usa como base
IF OBJECT_ID('dbo.textos') IS NULL
CREATE TABLE dbo.textos (
  id     INT IDENTITY PRIMARY KEY,
  titulo NVARCHAR(160) NOT NULL,
  texto  NVARCHAR(MAX) NULL
);
GO

-- 004 · status "aguardando": a vaga espera você responder uma pergunta na caixa de Perguntas
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_vaga_status' AND definition NOT LIKE '%aguardando%')
BEGIN
  ALTER TABLE dbo.vagas DROP CONSTRAINT ck_vaga_status;
  ALTER TABLE dbo.vagas ADD CONSTRAINT ck_vaga_status
    CHECK (status IN ('nova','na_fila','descartada','candidatada','testada','pulada','erro','aguardando'));
END
GO

-- 005 · caixa de perguntas: o que o bot não soube responder, para você responder UMA vez
IF OBJECT_ID('dbo.perguntas') IS NULL
CREATE TABLE dbo.perguntas (
  id            INT IDENTITY PRIMARY KEY,
  chave         NVARCHAR(400)  NOT NULL,   -- pergunta sem acento/numeração (evita repetir)
  pergunta      NVARCHAR(1000) NOT NULL,
  tipo          NVARCHAR(20)   NULL,       -- texto | textarea | radio | select | caixinhas...
  opcoes        NVARCHAR(MAX)  NULL,       -- JSON com as opções, se for de escolha
  resposta      NVARCHAR(MAX)  NULL,       -- NULL = esperando você
  vagas         NVARCHAR(MAX)  NULL,       -- JSON com os ids das vagas que esperam esta resposta
  vezes         INT            NOT NULL DEFAULT 1,
  criada_em     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  respondida_em DATETIME2      NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_perguntas_chave')
CREATE UNIQUE INDEX ux_perguntas_chave ON dbo.perguntas(chave);
GO

-- 006 · status "para_voce": vaga que só dá para se candidatar com você (ex.: Candidatura simplificada do LinkedIn)
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_vaga_status' AND definition NOT LIKE '%para_voce%')
BEGIN
  ALTER TABLE dbo.vagas DROP CONSTRAINT ck_vaga_status;
  ALTER TABLE dbo.vagas ADD CONSTRAINT ck_vaga_status
    CHECK (status IN ('nova','na_fila','descartada','candidatada','testada','pulada','erro','aguardando','para_voce'));
END
GO

-- 007 · foto de perfil (algumas vagas pedem)
IF COL_LENGTH('dbo.perfil', 'foto_arquivo') IS NULL ALTER TABLE dbo.perfil ADD foto_arquivo NVARCHAR(300) NULL;
GO

-- 008 · acompanhamento dos processos seletivos (e-mails das empresas, entendidos pela IA)
IF OBJECT_ID('dbo.processos') IS NULL
CREATE TABLE dbo.processos (
  id          INT IDENTITY PRIMARY KEY,
  email_id    NVARCHAR(400)  NOT NULL,   -- Message-ID do e-mail (evita repetir)
  vaga_id     INT            NULL,       -- vaga do Rota, quando deu para ligar
  empresa     NVARCHAR(160)  NULL,
  vaga_titulo NVARCHAR(200)  NULL,
  situacao    NVARCHAR(30)   NOT NULL,   -- recebida | em_analise | avancou | teste | entrevista | proposta | aprovado | reprovado | outro
  resumo      NVARCHAR(1000) NULL,
  acao        NVARCHAR(500)  NULL,       -- o que VOCÊ precisa fazer (se algo)
  prazo       NVARCHAR(40)   NULL,
  assunto     NVARCHAR(300)  NULL,
  recebido_em DATETIME2      NOT NULL,
  notificado  BIT            NOT NULL DEFAULT 0,
  criado_em   DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_processos_email')
CREATE UNIQUE INDEX ux_processos_email ON dbo.processos(email_id);
GO

-- 009 · processos: link do processo (tirado do e-mail), prazo como data e lembrete da véspera
IF COL_LENGTH('dbo.processos', 'link') IS NULL ALTER TABLE dbo.processos ADD link NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.processos', 'prazo_data') IS NULL ALTER TABLE dbo.processos ADD prazo_data DATE NULL;
IF COL_LENGTH('dbo.processos', 'prazo_hora') IS NULL ALTER TABLE dbo.processos ADD prazo_hora NVARCHAR(5) NULL;
IF COL_LENGTH('dbo.processos', 'lembrete_enviado') IS NULL ALTER TABLE dbo.processos ADD lembrete_enviado BIT NOT NULL CONSTRAINT df_proc_lembrete DEFAULT 0;
GO
