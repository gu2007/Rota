# Rota na AWS

Guia para rodar o Rota numa instância EC2, funcionando com o computador desligado.

## Custos (contas novas, plano gratuito)

Desde julho de 2025, contas novas da AWS recebem até **US$ 200 em créditos** no plano gratuito, que dura **6 meses ou até os créditos acabarem**. Ao fim do prazo a conta do plano gratuito é encerrada, a menos que seja convertida para o plano pago.

O Rota precisa de ~4 GB de RAM (SQL Server + Chromium do bot + Chrome do WhatsApp), então a instância é uma **t3.medium**. Valores aproximados por mês (Linux, sob demanda):

| Região | Instância | Disco 30 GB + IPv4 público | Total/mês | Créditos de US$ 200 duram |
|---|---|---|---|---|
| us-east-1 (Virgínia) | ~US$ 30 | ~US$ 6 | ~US$ 36 | ~5,5 meses |
| sa-east-1 (São Paulo) | ~US$ 49 | ~US$ 8 | ~US$ 57 | ~3,5 meses |

Confira os valores atuais na calculadora da AWS antes de criar. Desligar a instância à noite reduz o gasto (cobra só disco e IP enquanto parada).

## Segurança (faça antes de criar qualquer coisa)

1. **MFA no usuário raiz** (IAM > Security credentials > Assign MFA).
2. **Alerta de orçamento**: Billing > Budgets > template "Zero spend" e outro de US$ 10, com aviso por e-mail.
3. **Security group** da instância: só a porta **22 (SSH)**, liberada **só para o seu IP**. A porta 3000 **não** é aberta: o painel escuta apenas em 127.0.0.1 e é acessado por túnel SSH.
4. O `.env` e a pasta `dados/` nunca vão para o GitHub. No servidor, eles chegam por `scp`.

## Passo a passo

### 1. Criar a instância
EC2 > Launch instance:
- Nome `rota`, imagem **Ubuntu Server 24.04 LTS (x86_64)**, tipo **t3.medium**
- Key pair novo (`rota.pem`, guarde bem; sem ele não há acesso)
- Security group: SSH, origem **My IP**
- Disco: **30 GB gp3**

### 2. Conectar (Windows, PowerShell)
```powershell
icacls .\rota.pem /inheritance:r /grant:r "$($env:USERNAME):(R)"   # o SSH exige que só você leia a chave
ssh -i .\rota.pem ubuntu@IP_DA_INSTANCIA
```

### 3. Instalar
```bash
git clone https://github.com/gu2007/Rota.git rota && cd rota
bash deploy/instalar-ubuntu.sh
exit   # entre de novo para o grupo docker valer
```

### 4. Levar a configuração do PC
No PC, crie `.env.servidor` a partir do seu `.env`, mudando só:
```
DB_SERVER=localhost
DB_USER=sa
DB_PASSWORD=<senha nova: maiúsculas, minúsculas, números e @, sem espaço; mínimo 10 caracteres>
NAVEGADOR_OCULTO=true
NAVEGADOR_CANAL=chromium
```
**Mantenha a mesma `ROTA_CHAVE`**: é ela que abre o cofre de dados pessoais e as sessões. Envie:
```powershell
scp -i .\rota.pem .\.env.servidor ubuntu@IP:~/rota/.env
```
No servidor, converta as quebras de linha do Windows: `sed -i 's/\r$//' ~/rota/.env`

### 5. Banco de dados
Servidor:
```bash
cd ~/rota
docker compose -f deploy/docker-compose.yml --env-file .env up -d
```
PC (SSMS): botão direito no banco **Rota** > Tarefas > Fazer Backup > arquivo `rota.bak`. Envie e restaure:
```powershell
scp -i .\rota.pem .\rota.bak ubuntu@IP:~/rota/deploy/backup/rota.bak
```
```bash
bash deploy/restaurar-backup.sh
npm run db:init        # aplica migrações que faltarem
rm deploy/backup/rota.bak
```

### 6. Logins (Gupy/LinkedIn e WhatsApp)
PC: `npm run sessao:exportar` e envie `dados/sessao-completa.cofre`:
```powershell
scp -i .\rota.pem .\dados\sessao-completa.cofre ubuntu@IP:~/rota/dados/
```
Servidor:
```bash
npm run sessao:importar
npm run whatsapp:conectar   # QR Code aparece no terminal
```

### 7. Ligar de vez
```bash
pm2 start deploy/ecosystem.config.js
pm2 save && pm2 startup     # rode o comando que o pm2 mostrar, para voltar sozinho após reiniciar
pm2 logs rota
```

### 8. Abrir o painel (túnel SSH)
```powershell
ssh -i .\rota.pem -N -L 3000:localhost:3000 ubuntu@IP
```
Com esse terminal aberto, acesse http://localhost:3000 no seu navegador.

## Dia a dia
- Atualizar: `cd ~/rota && git pull && npm ci && npm run db:init && pm2 restart rota`
- Ver o que está acontecendo: `pm2 logs rota`
- Memória: `free -h` · Disco: `df -h`

## Quando os créditos acabarem
Converter para o plano pago (custo da tabela acima) ou mover o Rota para outro provedor. Como tudo roda em Docker + PM2 com este roteiro, a mudança é repetir os passos 2 a 8 no servidor novo.
