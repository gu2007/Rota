# Rota no servidor (Oracle Cloud, grátis)

O Rota roda 24h numa instância **Always Free** da Oracle, com o PC desligado. Sem custo: a instância ARM (Ampere A1) do plano Always Free não é cobrada enquanto ficar dentro do limite gratuito.

O SQL Server não roda em ARM, então no servidor o banco é **PostgreSQL** (`DB_TIPO=postgres`). O código é o mesmo: `src/db/index.js` escolhe o repositório pelo `.env`. O PC continua com SQL Server.

## Segurança
- A porta do painel (3000) **não** é aberta na internet: o servidor escuta em 127.0.0.1 e o painel é acessado por **túnel SSH**.
- O PostgreSQL também só escuta em 127.0.0.1.
- `.env`, `dados/` e os arquivos `.cofre` nunca vão para o GitHub. Chegam ao servidor por `scp` e os `.cofre` se apagam depois de importados.

## Passo a passo

### 1. Instância
Compute > Instances > Create instance:
- Imagem **Canonical Ubuntu 24.04** (ou 22.04), shape **VM.Standard.A1.Flex** (Always Free), com OCPU e memória dentro do que sobrar do limite gratuito (veja o fim deste guia)
- Chave SSH: baixe a chave privada (`rota.key`) e guarde bem
- Disco de boot padrão (47 GB, dentro do gratuito)

### 2. Conectar (Windows, PowerShell)
```powershell
icacls .\rota.key /inheritance:r /grant:r "$($env:USERNAME):(R)"
ssh -i .\rota.key ubuntu@IP_DA_INSTANCIA
```

### 3. Instalar
```bash
git clone https://github.com/gu2007/Rota.git rota && cd rota
bash deploy/instalar-ubuntu.sh
exit   # entre de novo para o grupo docker valer
```

### 4. Levar a configuração do PC
No PC, copie o `.env` para `.env.servidor` e mude só:
```
DB_TIPO=postgres
DB_SERVER=localhost
DB_PORT=5432
DB_DATABASE=rota
DB_USER=rota
DB_PASSWORD=<uma senha nova, só letras e números>
NAVEGADOR_OCULTO=true
NAVEGADOR_CANAL=chromium
```
**Mantenha a mesma `ROTA_CHAVE`**: é ela que abre o cofre de dados pessoais e os arquivos de transferência.
```powershell
scp -i .\rota.key .\.env.servidor ubuntu@IP:~/rota/.env
```
No servidor: `sed -i 's/\r$//' ~/rota/.env` (tira as quebras de linha do Windows).

### 5. Banco
Servidor:
```bash
cd ~/rota
docker compose -f deploy/docker-compose.yml --env-file .env up -d
npm run db:init
```
PC (com o SQL Server ligado):
```powershell
npm run dados:exportar
scp -i .\rota.key .\dados\banco.cofre ubuntu@IP:~/rota/dados/
```
Servidor:
```bash
npm run dados:importar   # substitui o que houver no banco do servidor
```

### 6. Logins (Gupy/LinkedIn e WhatsApp)
PC: `npm run sessao:exportar` e
```powershell
scp -i .\rota.key .\dados\sessao-completa.cofre ubuntu@IP:~/rota/dados/
```
Servidor:
```bash
npm run sessao:importar
npm run whatsapp:conectar   # QR Code aparece no terminal
```

### 7. Ligar de vez
```bash
pm2 start deploy/ecosystem.config.js
pm2 save && pm2 startup     # rode o comando que o pm2 mostrar
pm2 logs rota
```

### 8. Painel (túnel SSH)
```powershell
ssh -i .\rota.key -N -L 3000:localhost:3000 ubuntu@IP
```
Com esse terminal aberto, acesse http://localhost:3000.

## Dia a dia
- Atualizar: `cd ~/rota && git pull && npm ci && npm run db:init && pm2 restart rota`
- Logs: `pm2 logs rota` · Memória: `free -h` · Disco: `df -h`
- Cópia do banco do servidor: `npm run dados:exportar` gera `dados/banco.cofre` (cifrado)

## Instância parada pela Oracle?
A Oracle pode recuperar instâncias Always Free **ociosas**: quando, por 7 dias, CPU (percentil 95), rede **e** memória ficam todas abaixo de 20%. Se acontecer, ligue a instância de novo no painel da Oracle; o PM2 sobe o Rota sozinho.

Limites gratuitos atuais do Ampere A1: 2 OCPU e 12 GB no total, que podem ser divididos entre até 2 instâncias; 200 GB de disco somando todas.
