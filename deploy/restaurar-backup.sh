#!/usr/bin/env bash
# Restaura no container o backup do banco feito no PC (SSMS > Tarefas > Fazer Backup).
# Coloque o arquivo em deploy/backup/rota.bak e rode:  bash deploy/restaurar-backup.sh
set -euo pipefail
set -a; source <(sed 's/\r$//' .env); set +a   # .env vindo do Windows pode ter \r no fim das linhas

SQL="/opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P $DB_PASSWORD"
ARQ=/var/opt/mssql/backup/rota.bak

# nomes lógicos dos arquivos dentro do backup (dados e log)
LISTA=$(docker exec rota-sqlserver $SQL -h -1 -W -s"|" -Q "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK='$ARQ'")
DADOS=$(echo "$LISTA" | awk -F'|' '$3=="D"{print $1; exit}')
LOG=$(echo "$LISTA" | awk -F'|' '$3=="L"{print $1; exit}')

docker exec rota-sqlserver $SQL -Q "RESTORE DATABASE [$DB_DATABASE] FROM DISK='$ARQ' WITH REPLACE,
  MOVE '$DADOS' TO '/var/opt/mssql/data/$DB_DATABASE.mdf',
  MOVE '$LOG' TO '/var/opt/mssql/data/${DB_DATABASE}_log.ldf'"
echo "Banco $DB_DATABASE restaurado."
