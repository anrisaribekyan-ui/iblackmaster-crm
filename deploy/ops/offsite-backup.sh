#!/usr/bin/env bash
# Часовой бэкап CRM «наружу»: дамп БД + фото заказов + .env → шифрованные снимки restic
# в каждое хранилище из RESTIC_REPOS (VPS по SSH и/или Yandex Object Storage).
# Запускается таймером crm-offsite-backup (каждый час, от root). Руками: sudo ./offsite-backup.sh
set -uo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

exec 9>"$STATE_DIR/backup.lock"
flock -n 9 || { log "предыдущий бэкап ещё идёт — пропускаю"; exit 0; }

[ -n "${RESTIC_PASSWORD:-}" ] && [ -n "${RESTIC_REPOS:-}" ] || { notify "❌ Бэкап CRM: не заданы RESTIC_PASSWORD / RESTIC_REPOS в ops.env"; exit 1; }
export RESTIC_PASSWORD

STAGE="$DEPLOY_DIR/backups/stage"
mkdir -p "$STAGE"
failures=()

# 1. Свежий дамп БД (не зависим от контейнера backup)
if ! dump_db "$STAGE/crm.sql.gz"; then
  notify "❌ Бэкап CRM: не удалось снять дамп БД (контейнер db не отвечает?)"
  exit 1
fi
dump_size=$(stat -c %s "$STAGE/crm.sql.gz")
if [ "$dump_size" -lt "${MIN_DUMP_BYTES:-100000}" ]; then
  notify "❌ Бэкап CRM: дамп подозрительно маленький (${dump_size} байт) — в offsite НЕ отправляю, чтобы не затереть хорошую копию"
  exit 1
fi

# 2. Секреты и версия кода (нужны, чтобы поднять сервер с нуля)
if [ -f "$DEPLOY_DIR/.env" ]; then install -m 600 "$DEPLOY_DIR/.env" "$STAGE/env"; fi
git_repo rev-parse HEAD > "$STAGE/git-rev.txt" 2>/dev/null || true

# 3. Фото заказов: читаем прямо из тома docker (скрипт работает от root)
uploads_dir="$(docker volume inspect "${COMPOSE_PROJECT}_uploads" --format '{{.Mountpoint}}' 2>/dev/null || true)"
paths=("$STAGE")
if [ -n "$uploads_dir" ] && [ -d "$uploads_dir" ]; then
  echo "$uploads_dir" > "$STAGE/uploads_path.txt"
  paths+=("$uploads_dir")
else
  echo "" > "$STAGE/uploads_path.txt"
  log "(том с фото не найден — копирую только БД и .env)"
fi

# 4. Снимок в каждое хранилище
ok_repos=0
for repo in $RESTIC_REPOS; do
  if ! restic -r "$repo" cat config >/dev/null 2>&1; then
    log "хранилище $repo ещё не создано — инициализирую"
    if ! restic -r "$repo" init >/dev/null 2>&1; then
      failures+=("не удалось создать/открыть $repo")
      continue
    fi
  fi
  if ! restic -r "$repo" backup "${paths[@]}" --tag crm --host "$RESTIC_HOST" --quiet; then
    failures+=("снимок не записан в $repo")
    continue
  fi
  restic -r "$repo" forget --tag crm --host "$RESTIC_HOST" \
    --keep-hourly 48 --keep-daily 30 --keep-weekly 12 --keep-monthly 12 --quiet >/dev/null 2>&1 \
    || failures+=("не отработала очистка старых снимков в $repo")
  # Физическое освобождение места — раз в сутки ночью (операция тяжёлая)
  if [ "$(date +%H)" = "03" ]; then restic -r "$repo" prune --quiet >/dev/null 2>&1 || true; fi
  ok_repos=$((ok_repos + 1))
done

# 5. Итог
if [ "${#failures[@]}" -gt 0 ]; then
  notify "⚠️ Бэкап CRM: успешно в $ok_repos хранилищ, проблемы: $(printf '%s; ' "${failures[@]}")"
fi
if [ "$ok_repos" -eq 0 ]; then exit 1; fi

# Раз в сутки (первый успешный запуск после 09:00) — короткое «всё хорошо».
# Если такого сообщения нет — значит, таймер или сервер умерли.
today="$(date +%F)"
if [ "$(date +%H)" -ge 9 ] && [ "$(cat "$STATE_DIR/last-ok-notice" 2>/dev/null)" != "$today" ]; then
  first_repo="${RESTIC_REPOS%% *}"
  snaps="$(restic -r "$first_repo" snapshots --tag crm --host "$RESTIC_HOST" --json 2>/dev/null | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))' 2>/dev/null || echo '?')"
  notify "✅ Бэкап CRM в порядке: хранилищ $ok_repos, снимков в первом $snaps, дамп $((dump_size / 1024)) КБ"
  echo "$today" > "$STATE_DIR/last-ok-notice"
fi
log "бэкап готов: хранилищ $ok_repos"
exit 0
