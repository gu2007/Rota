# Rota

Bot de candidaturas para vagas de estágio e júnior em tecnologia. Ele encontra vagas, decide se valem a pena, se candidata sozinho e acompanha os processos seletivos, avisando no WhatsApp quando algo muda.

Projeto pessoal em **Node.js + SQL Server/PostgreSQL**, com automação de navegador (**Playwright**) e IA (**Google Gemini**) para entender formulários que mudam de empresa para empresa.

## O que ele faz

- **Encontra vagas** no portal público da Gupy e nos alertas de vaga que chegam no Gmail (LinkedIn, InfoJobs, Indeed e outros).
- **Dá uma nota de 0 a 100** para cada vaga: área de TI, nível (estágio/júnior), cidade e modelo de trabalho. Só entram na fila as que passam da nota mínima.
- **Se candidata sozinho** na Gupy e em sites de empresas (SmartRecruiters, Factorial e similares):
  - lê cada etapa do formulário e responde com os dados do perfil, respostas fixas e IA;
  - a IA escolhe botões desconhecidos e, quando uma tela trava, entra um "modo agente" que lê um mapa da página e diz o que preencher;
  - respeita o limite de caracteres que aparece na tela e corta no fim de uma frase.
- **Aprende com o usuário**: perguntas que só ele sabe responder vão para uma caixa no painel. Respondida uma vez, a resposta vale para todas as empresas, e a IA reconhece a mesma pergunta escrita de outro jeito.
- **Age como uma pessoa**: horários aleatórios dentro de uma janela, intervalo mínimo entre ações e limite diário por plataforma.
- **Acompanha os processos**: lê os e-mails das empresas, a IA identifica a etapa (teste, entrevista, reprovado...), o que fazer e o prazo, e o Rota avisa no WhatsApp, com lembrete na véspera do prazo.

## O que ele não faz (de propósito)

- Não resolve CAPTCHA nem tenta burlar verificações anti-robô.
- Não faz testes comportamentais ou técnicos pela pessoa.
- Não inventa experiência: a IA só usa fatos do perfil; se não sabe, pergunta.
- Não usa a "Candidatura simplificada" do LinkedIn nem cria contas em sites. Esses casos ficam numa aba "Para você".
- Vagas afirmativas só entram se o usuário ligar essa opção.

## Arquitetura

```
coleta ──► pontuação ──► fila ──► agendador ──► candidatura ──► histórico
 (Gupy, Gmail,           (regras)      (horários       (Playwright + IA)
  LinkedIn)                             aleatórios)
                                                        e-mails das empresas ──► IA ──► WhatsApp
```

| Pasta | O que tem |
|---|---|
| `src/plataformas/` | Coletores (portal Gupy, e-mail, LinkedIn) e o motor de candidatura (Gupy, sites, InfoJobs) |
| `src/candidatura/` | Leitura dos campos da página, decisão de cada resposta e aprendizado |
| `src/ia/` | Integração com o Gemini e o pontuador de vagas |
| `src/agendador/` | Planejamento dos horários do dia e execução |
| `src/acompanhamento/` | Leitura dos e-mails de processo seletivo e avisos |
| `src/db/` | Repositórios SQL Server (PC), PostgreSQL (servidor) e em memória (modo demo), todos com a mesma interface |
| `public/` | Painel web em JavaScript puro |
| `db/schema.sql` | Esquema do banco, idempotente, com migrações |

Algumas decisões que valem destacar:

- **Repository pattern**: o resto do sistema chama `repo.vagas.listar()` sem saber se é SQL Server, PostgreSQL ou memória. Isso permite rodar o painel em modo demo sem banco.
- **Colunas dinâmicas por lista branca**: as queries montadas a partir do painel só aceitam nomes de campo conhecidos, o que evita SQL injection.
- **Dados pessoais criptografados** (AES-256-GCM): CPF, RG e endereço ficam cifrados no banco, e o painel só recebe o final mascarado. A sessão do navegador também é salva cifrada.
- **Leitura de formulários genérica**: em vez de seletores fixos por site, o bot lê rótulos, tipos e opções de cada campo, inclusive dentro de shadow DOM.

## Como rodar

Requisitos: Node.js 18+, Google Chrome e, para uso real, SQL Server.

```bash
npm install
npm run demo            # painel com dados fictícios em http://localhost:3000, sem banco
```

Uso real:

```bash
cp .env.example .env    # preencha banco, chave do Gemini, Gmail e WhatsApp
npm run db:init         # cria ou atualiza o banco
npm start
```

O guia completo de comandos e configuração está em [docs/uso.md](docs/uso.md). Para rodar 24h num servidor gratuito (Oracle Cloud, ARM, com PostgreSQL, Docker e PM2), veja [docs/servidor.md](docs/servidor.md).

## Stack

Node.js · Express · SQL Server (mssql) · PostgreSQL (pg) · Playwright · Google Gemini API · IMAP (imapflow) · whatsapp-web.js · HTML/CSS/JS puro no painel

## Próximos passos

- Melhorar a candidatura em sites de empresas com formulários mais complexos.
