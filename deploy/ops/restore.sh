#!/usr/bin/env bash
# Восстановление CRM из бэкапа restic.
#
#   ./restore.sh                      — поднять CRM из последнего снимка на этом (новом или пустом) сервере
#   ./restore.sh --force              — то же, но поверх уже существующей БД (старая будет удалена!)
#   ./restore.sh --test               — проверка: развернуть последний снимок во временную БД и сверить данные (живую CRM не трогает)
#   ./restore.sh --repo <хранилище>   — взять снимок из конкретного хранилища (по умолчанию — первое рабочее из RESTIC_REPOS)
#   ./restore.sh --snapshot <id>      — не последний снимок, а выбранный (список: restic -r <хранилище> snapshots)
#
# Нужны: docker, restic, и deploy/ops.env с RESTIC_PASSWORD, RESTIC_REPOS (+ ключи S3, если s3:).
set -uo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

MODE=restore; FORCE=0; REPO=""; SNAP="latest"
while [ $# -gt 0 ]; do
  case "$1" in
    --test) MODE=test ;;
    --force) FORCE=1 ;;
    --repo) REPO="$2"; shift ;;
    --snapshot) SNAP="$2"; shift ;;
    *) echo "неизвестный параметр: $1"; exit 2 ;;
  esac
  shift
done

fail() { notify "❌ Восстановление CRM ($MODE): $*"; exit 1; }
[ -n "${RESTIC_PASSWORD:-}" ] || fail "не задан RESTIC_PASSWORD (deploy/ops.env)"
export RESTIC_PASSWORD

# Выбор хранилища: заданное или первое, из которого читается снимок
if [ -z "$REPO" ]; then
  for r in ${RESTIC_REPOS:-}; do
    if restic -r "$r" snapshots --tag crm --host "$RESTIC_HOST" --latest 1 >/dev/null 2>&1; then REPO="$r"; break; fi
    log "хранилище $r недоступно или пусто — пробую следующее"
  done
fi
[ -n "$REPO" ] || fail "ни одно хранилище из RESTIC_REPOS не открылось"
log "беру снимок $SNAP из $REPO"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/crm-restore.XXXXXX")"
trap 'rm -rf "$WORK"; docker rm -f crm-restore-test >/dev/null 2>&1 || true' EXIT
restic -r "$REPO" restore "$SNAP" --tag crm --host "$RESTIC_HOST" --target "$WORK" --quiet || fail "restic не смог распаковать снимок"

DUMP="$(find "$WORK" -name crm.sql.gz -print -quit)"
[ -n "$DUMP" ] || fail "в снимке нет дампа БД"
gzip -t "$DUMP" || fail "дамп в снимке повреждён"
STAGE_RESTORED="$(dirname "$DUMP")"
ORIG_UPLOADS="$(cat "$STAGE_RESTORED/uploads_path.txt" 2>/dev/null || true)"
UPLOADS_RESTORED=""
[ -n "$ORIG_UPLOADS" ] && [ -d "$WORK$ORIG_UPLOADS" ] && UPLOADS_RESTORED="$WORK$ORIG_UPLOADS"
SNAP_INFO="$(restic -r "$REPO" snapshots "$SNAP" --tag crm --host "$RESTIC_HOST" --json 2>/dev/null \
  | python3 -c 'import sys,json; s=json.load(sys.stdin)[-1]; print(s["time"][:16].replace("T"," ")+" UTC, "+s["short_id"])' 2>/dev/null || echo "?")"

# Сколько строк в ключевых таблицах (имена, которых нет, пропускаем)
count_rows() { # $1 = команда psql
  for t in '"order"' counteragent employee order_position; do
    n="$($1 -tAc "SELECT CASE WHEN to_regclass('$t') IS NULL THEN -1 ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM $t', false, true, '')))[1]::text::int END" 2>/dev/null)"
    [ "${n:--1}" != "-1" ] && printf '%s=%s ' "${t//\"/}" "$n"
  done
}

if [ "$MODE" = test ]; then
  IMG="${REGISTRY:-docker.io/library}/postgres:16-alpine"
  docker rm -f crm-restore-test >/dev/null 2>&1 || true
  docker run -d --name crm-restore-test -e POSTGRES_PASSWORD=test -e POSTGRES_USER=crm -e POSTGRES_DB=crm "$IMG" >/dev/null || fail "не смог запустить временный postgres"
  for _ in $(seq 1 30); do docker exec crm-restore-test pg_isready -U crm -d crm >/dev/null 2>&1 && break; sleep 1; done
  gunzip -c "$DUMP" | docker exec -i crm-restore-test psql -U crm -d crm -v ON_ERROR_STOP=1 -q >/dev/null 2>"$WORK/psql.err" \
    || fail "дамп не загрузился во временную БД: $(tail -n 3 "$WORK/psql.err" | tr '\n' ' ')"
  rows="$(count_rows 'docker exec crm-restore-test psql -U crm -d crm')"
  [ -n "$rows" ] || fail "БД загрузилась, но в ней нет ожидаемых таблиц"
  files=0; [ -n "$UPLOADS_RESTORED" ] && files="$(find "$UPLOADS_RESTORED" -type f | wc -l)"
  notify "✅ Тест восстановления CRM пройден. Снимок: $SNAP_INFO. Данные: ${rows}фото-файлов=$files"
  exit 0
fi

# ── Боевое восстановление ───────────────────────────────────────────────────
[ -f "$DEPLOY_DIR/.env" ] || { install -m 600 "$STAGE_RESTORED/env" "$DEPLOY_DIR/.env" 2>/dev/null && chown --reference="$DEPLOY_DIR" "$DEPLOY_DIR/.env" && log "восстановил deploy/.env из снимка"; }
[ -f "$DEPLOY_DIR/.env" ] || fail "нет deploy/.env (ни на сервере, ни в снимке)"

log "поднимаю базу"
dc up -d db >/dev/null || fail "не поднялась БД"
for _ in $(seq 1 60); do dc exec -T db pg_isready -U crm -d crm >/dev/null 2>&1 && break; sleep 1; done

existing="$(dc exec -T db psql -U crm -d crm -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null | tr -d '[:space:]')"
if [ "${existing:-0}" -gt 0 ]; then
  [ "$FORCE" -eq 1 ] || fail "в БД уже есть данные ($existing таблиц). Если уверены — запустите с --force (старые данные будут удалены)"
  log "--force: удаляю текущую БД"
  dc stop web backend backup >/dev/null 2>&1 || true
  dc exec -T db psql -U crm -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE crm WITH (FORCE)" -c "CREATE DATABASE crm OWNER crm" >/dev/null || fail "не удалось пересоздать БД"
fi

log "загружаю данные"
gunzip -c "$DUMP" | dc exec -T db psql -U crm -d crm -v ON_ERROR_STOP=1 -q >/dev/null 2>"$WORK/psql.err" \
  || fail "дамп не загрузился: $(tail -n 3 "$WORK/psql.err" | tr '\n' ' ')"

log "поднимаю CRM (сборка может занять пару минут)"
dc up -d --build >/dev/null 2>&1 || fail "docker compose up не отработал"
if [ -n "$UPLOADS_RESTORED" ]; then
  dc cp "$UPLOADS_RESTORED/." backend:/app/uploads/ || log "(фото скопировать не удалось)"
fi
for _ in $(seq 1 30); do backend_healthy && break; sleep 2; done
backend_healthy || fail "данные загружены, но бэкенд не отвечает — смотрите: docker compose logs backend"

rows="$(count_rows 'dc exec -T db psql -U crm -d crm')"
notify "✅ CRM восстановлена из снимка $SNAP_INFO. Данные: $rows"
echo
echo "Дальше: проверьте DNS (домен должен смотреть на этот сервер), откройте CRM и войдите."
echo "Автодеплой и бэкап включаются командой: sudo $OPS_DIR/install-host.sh"
