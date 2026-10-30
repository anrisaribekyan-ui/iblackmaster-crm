#!/usr/bin/env bash
# Общие функции скриптов обслуживания. Подключается через `source`, сам ничего не запускает.
# Скрипты работают на хосте сервера (не в контейнерах): им нужны docker, git и restic.

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$OPS_DIR")"
REPO_DIR="$(dirname "$DEPLOY_DIR")"
OPS_ENV="${OPS_ENV:-$DEPLOY_DIR/ops.env}"
STATE_DIR="${STATE_DIR:-$DEPLOY_DIR/.ops-state}"
COMPOSE_PROJECT="iblackmaster-crm"   # name: в docker-compose.yml → имена томов вида iblackmaster-crm_uploads
RESTIC_HOST="crm-server"             # фиксированное «имя хоста» в снимках: чтобы после переезда на новый сервер история не рвалась

if [ -f "$OPS_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$OPS_ENV"
  set +a
fi
mkdir -p "$STATE_DIR"

log() { echo "$(date '+%F %T') $*"; }

dc() { (cd "$DEPLOY_DIR" && docker compose "$@"); }

git_repo() { git -c safe.directory='*' -C "$REPO_DIR" "$@"; }

# Сообщение в Telegram (если заданы TG_BOT_TOKEN и TG_CHAT_ID). Никогда не валит скрипт.
# Из России api.telegram.org может не открываться — тогда задайте TG_PROXY (например socks5h://127.0.0.1:1080).
notify() {
  local text="$1"
  log "$text"
  if [ -n "${TG_BOT_TOKEN:-}" ] && [ -n "${TG_CHAT_ID:-}" ]; then
    local proxy=()
    [ -n "${TG_PROXY:-}" ] && proxy=(--proxy "$TG_PROXY")
    curl -fsS --max-time 20 "${proxy[@]}" -X POST \
      "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TG_CHAT_ID}" \
      --data-urlencode "text=${text}" >/dev/null 2>&1 \
      || log "(не удалось отправить в Telegram)"
  fi
  return 0
}

# Бэкенд отвечает на /api/health? (проверка изнутри контейнера: не зависит от домена и HTTPS)
backend_healthy() {
  dc exec -T backend python -c \
    "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/api/health', timeout=5).status == 200 else 1)" \
    >/dev/null 2>&1
}

# Дамп БД в файл .sql.gz; проверяет, что файл целый (pg_dump дописывает метку в конец).
dump_db() {
  local out="$1" tmp
  tmp="$(mktemp "${out}.XXXXXX")"
  if ! dc exec -T db pg_dump -U crm crm | gzip > "$tmp"; then rm -f "$tmp"; return 1; fi
  if ! gzip -t "$tmp" || ! gunzip -c "$tmp" | tail -n 5 | grep -q 'dump complete'; then
    rm -f "$tmp"; return 1
  fi
  mv "$tmp" "$out"
}

