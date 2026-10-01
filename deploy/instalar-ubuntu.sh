#!/usr/bin/env bash
# Prepara um Ubuntu 24.04 novo para o Rota: fuso, swap, Docker, Node 22, PM2 e o Chromium do Playwright.
# Rode uma vez, dentro da pasta do projeto:  bash deploy/instalar-ubuntu.sh
set -euo pipefail

echo "== fuso horário (o agendador usa o horário de São Paulo)"
sudo timedatectl set-timezone America/Sao_Paulo

echo "== swap de 2 GB (folga para o SQL Server + navegadores)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "== pacotes básicos e Docker"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl git unzip docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

echo "== Node.js 22 e PM2"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1)" != "v22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo npm install -g pm2

echo "== dependências do projeto e Chromium do Playwright (com as bibliotecas do sistema)"
npm ci
sudo npx playwright install-deps chromium
npx playwright install chromium

mkdir -p deploy/backup dados
echo
echo "Pronto. Saia e entre de novo no SSH (para o grupo docker valer) e siga o docs/aws.md."
