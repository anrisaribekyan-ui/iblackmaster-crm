#!/usr/bin/env bash
# Установка на сервер (один раз, от root): restic и таймеры systemd для автодеплоя, часового бэкапа и ежемесячной проверки восстановления.
#   sudo ./install-host.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Запустите через sudo"; exit 1; }
OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$OPS_DIR")"
RUN_USER="${SUDO_USER:-$(stat -c %U "$DEPLOY_DIR")}"

command -v restic >/dev/null || { apt-get update -qq && apt-get install -y -qq restic; }
command -v curl >/dev/null || apt-get install -y -qq curl
chmod +x "$OPS_DIR"/*.sh
mkdir -p "$DEPLOY_DIR/.ops-state"
chown -R "$RUN_USER" "$DEPLOY_DIR/.ops-state"

if [ ! -f "$DEPLOY_DIR/ops.env" ]; then
  install -m 600 -o "$RUN_USER" "$OPS_DIR/ops.env.example" "$DEPLOY_DIR/ops.env"
  echo ">> Создан $DEPLOY_DIR/ops.env — заполните его (nano) и запустите этот скрипт ещё раз."
  exit 0
fi

unit() { # имя  описание  пользователь  скрипт  [аргументы]
  cat > "/etc/systemd/system/$1.service" <<UNIT
[Unit]
Description=$2
After=docker.service network-online.target

[Service]
Type=oneshot
User=$3
ExecStart=$OPS_DIR/$4 ${5:-}
TimeoutStartSec=3600
UNIT
}
unit crm-autodeploy "CRM: автодеплой из GitHub" "$RUN_USER" autodeploy.sh
unit crm-offsite-backup "CRM: часовой бэкап наружу" root offsite-backup.sh
unit crm-restore-test "CRM: проверка восстановления из бэкапа" root restore.sh --test

timer() { # имя  описание  строки-расписания
  cat > "/etc/systemd/system/$1.timer" <<UNIT
[Unit]
Description=$2

[Timer]
$3
Persistent=true

[Install]
WantedBy=timers.target
UNIT
}
timer crm-autodeploy "CRM: автодеплой каждую минуту" $'OnBootSec=2min\nOnUnitActiveSec=60s'
timer crm-offsite-backup "CRM: бэкап каждый час" 'OnCalendar=*:15:00'
timer crm-restore-test "CRM: проверка восстановления раз в месяц" 'OnCalendar=*-*-01 04:30:00'

systemctl daemon-reload
systemctl enable --now crm-autodeploy.timer crm-offsite-backup.timer crm-restore-test.timer
echo
echo "Готово. Таймеры включены:"
systemctl list-timers 'crm-*' --no-pager
echo
echo "Проверить бэкап прямо сейчас:  sudo systemctl start crm-offsite-backup && journalctl -u crm-offsite-backup -n 30 --no-pager"
echo "Проверить восстановление:      sudo systemctl start crm-restore-test   && journalctl -u crm-restore-test -n 30 --no-pager"
