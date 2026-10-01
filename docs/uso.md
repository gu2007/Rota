# Guia de uso

Comandos, configuração e solução de problemas do Rota. Visão geral do projeto no [README](../README.md).

## Como rodar

**Só para ver (sem banco):**
```bash
npm install
npm run demo
```
Abra http://localhost:3000. No modo demo as empresas são fictícias e nada é salvo.

**De verdade (SQL Server):**
```bash
npm install
cp .env.example .env      # preencha DB_SERVER, DB_USER, DB_PASSWORD e GEMINI_API_KEY
npm run db:init           # cria/atualiza o banco (pode rodar sempre que atualizar o projeto)
npm start
```

**Gupy:** faça login uma vez no navegador do Rota e rode o teste principal:
```bash
npm run gupy:login                                        # entre na sua conta de candidato e FECHE a janela
npm run testar:gupy                                       # busca vagas reais e faz 1 candidatura em modo teste
npm run testar:gupy -- https://empresa.gupy.io/job/...    # testa uma vaga específica
npm run enviar:gupy                                       # candidatura de verdade (pede confirmação)
npm run testar:sites / enviar:sites                       # o mesmo para sites de empresas
```
**Caixa de Perguntas (o jeito normal de ensinar):** quando uma vaga pergunta algo que o Rota não sabe
responder com a verdade (CR, grade horária, "tem notebook?"), a pergunta vai para a página **Perguntas** do painel
e a vaga fica "Esperando você". Responda uma vez: vale para todas as empresas, e as vagas voltam para a fila sozinhas.
Botões com nomes diferentes ("Prosseguir", "Quero fazer parte") a IA descobre sozinha e o Rota memoriza.

**Modo aprender (opcional):** só para casos raros em que o bot travar de um jeito que a caixa não resolve:
```bash
npm run gupy:aprender -- https://empresa.gupy.io/job/...   # você se candidata, o Rota observa
```

**Outros comandos úteis:**
```bash
npm run testar:ia     # testa só a chave/modelo do Gemini
npm run repontuar     # recalcula as notas depois de mudar os Ajustes
npm run tentar:de-novo # devolve para a fila as vagas puladas/com erro (depois de uma atualização do bot)
npm run salvar         # git add + commit + push de uma vez (ou: npm run salvar "mensagem")
npm run marcar 207 candidatada   # muda o estado de uma vaga na mão (ex.: você mesmo enviou)
```
Ele anota os botões que você usou para avançar e finalizar, os avisos que você fechou e as suas respostas às perguntas objetivas, e usa isso nas próximas vagas. Dados pessoais (CPF, telefone, endereço, senha) não são gravados. Atenção: é uma candidatura de verdade.

Pare o `npm start` antes desses comandos: o navegador do Rota só pode ser usado por um comando de cada vez.

**Ver como o agendador espalharia os próximos dias:**
```bash
npm run simular -- 5
```

---

## Como o sistema pensa

```
 COLETA                          SELEÇÃO                     CANDIDATURA
 (onde acha vagas)               (quais valem a pena)        (onde se candidata)

 Portal Gupy (API pública) ─┐
 Alertas por e-mail        ─┼─► normaliza link ─► nota 0-100 ─► fila ─► Gupy
 LinkedIn / Google         ─┘    evita duplicata   abaixo do mínimo?     InfoJobs
                                                   → descartada          Sites
                    ▲                                                  │
                    └──────────── AGENDADOR (horários sorteados) ──────┘
                                           │
                                     HISTÓRICO (cada resposta enviada)
```

Tudo acontece **dentro da janela de atividade** (8h às 22h por padrão) e **até o limite diário** de cada plataforma.

---

## Mapa das pastas

| Arquivo | O que faz | Leia quando quiser entender… |
|---|---|---|
| `src/server.js` | Liga tudo: painel + executor | onde o programa começa |
| `src/config.js` | Lê o `.env` e converte as configurações | como ele escolhe entre demo e SQL |
| `src/agendador/planejador.js` | **Sorteia os horários do dia** em "sessões" | a lógica anti-ban |
| `src/agendador/executor.js` | Relógio que roda a cada 30s e dispara o que venceu | o fluxo completo de uma ação |
| `src/plataformas/portal-gupy.js` | Busca vagas no portal público da Gupy (JSON, sem navegador) | a coleta mais segura possível |
| `src/plataformas/gupy.js` | **Percorre o formulário** etapa por etapa (Gupy e sites de empresas) | o robô de candidatura e o modo agente |
| `src/plataformas/sites.js` | Usa o mesmo motor em sites de empresas | candidaturas fora da Gupy |
| `src/plataformas/email.js` | Lê os alertas de vaga do Gmail | a coleta por e-mail |
| `src/coleta/links-vagas.js` | Acha e padroniza links de vagas dentro de e-mails | como evitar vaga duplicada |
| `src/plataformas/linkedin.js` | Abre vagas do LinkedIn e descobre onde é a candidatura | LinkedIn sem usar a Candidatura simplificada |
| `src/acompanhamento/processos.js` | Lê e-mails das empresas e entende a etapa do processo | os avisos e lembretes |
| `src/notificacao/whatsapp.js` | Envia as mensagens no WhatsApp | conexão e confirmação de entrega |
| `src/candidatura/leitor-pagina.js` | Lê os campos da tela (roda dentro do navegador) | como "enxergar" qualquer formulário |
| `src/candidatura/respostas.js` | Decide a resposta de cada campo | por que a IA nunca inventa |
| `src/ia/gemini.js` | Chama o Gemini para perguntas abertas | o prompt com as regras de honestidade |
| `src/ia/pontuador.js` | Nota da vaga: área de TI, nível, cidade e modelo | por que uma vaga entra ou não na fila |
| `src/navegador/gravador.js` | Observa seus cliques no modo aprender | como o bot "assiste" você |
| `src/candidatura/aprendizado.js` | Transforma a gravação em regras (botões, avisos, respostas) | a memória do bot |
| `scripts/repontuar.js` | Recalcula a nota das vagas ainda não tentadas | quando mudar os Ajustes |
| `src/navegador/navegador.js` | Abre o seu Chrome com sessão salva e digita como gente | ritmo humano |
| `src/db/sql.js` | Todas as queries do SQL Server | queries parametrizadas, transação, MERGE |
| `src/db/postgres.js` | As mesmas queries em PostgreSQL (servidor) | `ON CONFLICT`, `RETURNING`, transação |
| `src/db/demo.js` | As mesmas funções, em memória | o padrão "Repository" |
| `src/db/modelo.js` | Quais campos cada tabela aceita | como evitar SQL injection em colunas dinâmicas |
| `src/db/padroes.js` | Plataformas, respostas fixas e configurações iniciais | onde mudar valores padrão |
| `src/rotas/api.js` | API REST usada pelo painel | rotas do Express e validação |
| `public/` | O painel (HTML, CSS e JS puros) | o front-end |
| `db/schema.sql` | Cria as tabelas e aplica as migrações | o modelo do banco |

### O conceito que amarra tudo: Repository

Nada fora de `src/db/` sabe que existe SQL. O executor chama `repo.vagas.proximaDaFila()`, e tanto faz se isso vem do SQL Server (`sql.js`), do PostgreSQL (`postgres.js`) ou da memória (`demo.js`); quem escolhe é `src/db/index.js`, pelo `DB_TIPO` do `.env`. É por isso que o modo demo funciona sem banco, e que dá para testar o executor sem tocar no banco.

---

## Como a candidatura na Gupy decide cada resposta

1. **Perfil**: nome, e-mail, telefone, LinkedIn, GitHub
2. **Respostas fixas**: salário, inglês, CNH, disponibilidade… (a IA nunca chuta estas)
3. **Regras**: aceita termos de privacidade; em perguntas de gênero, raça ou PcD só marca "Prefiro não informar"
4. **Currículo**: envia o PDF do caminho cadastrado no Perfil
5. **Caixa de Perguntas**: o que você respondeu na página Perguntas (mesma pergunta = mesma resposta; opções diferentes = a IA encaixa a sua resposta)
6. **Aprendido**: o que você respondeu quando o bot estava observando (só perguntas objetivas)
7. **IA (Gemini)**: recebe TUDO acima como contexto, então reconhece a mesma pergunta escrita de outro jeito. Se não há resposta verdadeira, a pergunta vai para a caixa de Perguntas e a vaga espera você

Se nenhum botão conhecido aparece na tela, a IA olha os botões visíveis e escolhe (nunca login, sair, cancelar ou voltar).

**Modo agente:** quando uma etapa trava (campo que o leitor normal não entende, como listas "inventadas" pelo site),
o bot monta um mapa da tela (campos, listas, botões, valores) e a IA diz o que fazer: preencher, escolher, marcar ou abrir uma lista.
Ela usa só os seus dados; o que só você sabe vai para a caixa **Perguntas**. Nunca clica em enviar: quem avança é o bot.
O botão escolhido é memorizado para a próxima vez. O botão final só é memorizado depois de uma candidatura confirmada.

Cada etapa gera um print e um JSON em `dados/gupy/<data>-vaga-<id>/`, para você conferir o que foi preenchido.

---

## Dados pessoais (cofre)

CPF, RG, nascimento e endereço ficam na tabela `dados_pessoais` **criptografados com AES-256-GCM** (`src/util/cofre.js`).
A chave (`ROTA_CHAVE`) é criada pelo `npm run db:init` e fica só no seu `.env`. Sem ela, o conteúdo do banco é ilegível.

- O painel (Perfil > Dados pessoais) só mostra o finalzinho de cada valor.
- O bot decifra na hora de preencher; no Histórico aparece "(dado pessoal)" e nos prints esses campos saem tarjados.
- No modo aprender, o que você digitar nesses campos vai direto para o cofre (a gravação fica com "(oculto)").
- O "lembrar formulários" do Chrome do Rota fica desligado, para os dados não ficarem no perfil do navegador.
- **Não perca a ROTA_CHAVE**: sem ela os dados salvos não abrem (é só cadastrar de novo).

## Travas de segurança

| Risco | O que o sistema faz |
|---|---|
| Padrão de robô | Horários sorteados todo dia, "sessões" com pausas longas, segundos aleatórios, mínimo de 15 min entre ações da mesma plataforma; digitação letra por letra e "leitura" da vaga antes de clicar |
| Excesso de ações | Limite diário por plataforma, conferido ao planejar e na hora de executar |
| CAPTCHA | Pausa a plataforma **até o fim do dia** e registra. Não tenta resolver |
| Computador desligado | Ação com mais de 20 min de atraso vira "perdida", não roda atrasada |
| Candidatar duas vezes | Link normalizado + índice único no banco + detecção de "você já se candidatou" |
| Resposta inventada | Perguntas objetivas só vêm das respostas fixas; perguntas abertas só com fatos do perfil |
| Vaga com teste online | Pulada (o teste é você que faz) |
| Primeiros dias | **Modo teste** preenche tudo e não clica em enviar |

---

## Alertas de e-mail e LinkedIn

```
Gmail (alertas do LinkedIn, Gupy, InfoJobs...)  ──►  email.js lê os links  ──►  pontua e põe na fila
                                                                   │
            link do LinkedIn? ──►  linkedin.js abre a página da vaga (2 por vez)
                                   ├─ "Candidatar-se" (site de fora) → fila da Gupy ou de sites, com descrição e nota nova
                                   ├─ "Candidatura simplificada"     → pulada: essa você faz pelo app
                                   └─ "Não aceita mais candidaturas" → descartada
```
O bot **não** pesquisa no LinkedIn e **não** usa a Candidatura simplificada: o LinkedIn proíbe automação e pode restringir a conta.

```bash
npm run testar:email      # lê os alertas agora e mostra o que entrou na fila
npm run testar:linkedin   # abre as próximas vagas do LinkedIn e descobre onde é a candidatura
```


## Observações

- O banco guarda horários em **UTC**. O "dia" segue o fuso do computador que roda o Rota.
- O painel só escuta em `127.0.0.1`: ninguém da sua rede consegue abrir.
- A pasta `dados/` guarda a sessão do navegador (seu login da Gupy) e os prints. Ela está no `.gitignore`.

## WhatsApp travou em "Conectando…"?

Um WhatsApp "escondido" de uma tentativa anterior pode ter ficado aberto segurando a sessão. Feche só ele (o seu Chrome normal não é afetado):

```powershell
Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*puppeteer*" } | Stop-Process -Force
```
