#!/usr/bin/env bash
# Автодеплой: раз в минуту смотрит, появился ли новый коммит в main на GitHub.
# Если да — снимает страховочный дамп БД, обновляет код, пересобирает контейнеры и проверяет, что бэкенд жив.
# Если не ожил — откатывает код на прошлую версию и пишет в Telegram.
# Запускается таймером crm-autodeploy от обычного пользователя (того, у кого настроен доступ к GitHub и docker).
set -uo pipefail
# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || exit 0

BRANCH="${DEPLOY_BRANCH:-main}"
cd "$REPO_DIR" || exit 1

git_repo fetch -q origin "$BRANCH" 2>/dev/null || { log "нет связи с GitHub — пропускаю"; exit 0; }
prev="$(git_repo rev-parse HEAD)"
target="$(git_repo rev-parse "origin/$BRANCH")"
[ "$prev" = "$target" ] && exit 0

# Уже пробовали выкатить именно этот коммит и он не завёлся — ждём нового, чтобы не крутиться в цикле
if [ "$(cat "$STATE_DIR/failed-sha" 2>/dev/null)" = "$target" ]; then exit 0; fi

# Ручные правки на сервере не затираем
if [ -n "$(git_repo status --porcelain --untracked-files=no)" ]; then
  echo "$target" > "$STATE_DIR/failed-sha"
  notify "⚠️ Автодеплой остановлен: на сервере есть незакоммиченные правки в $REPO_DIR. Посмотри: git status"
  exit 1
fi

subject="$(git_repo log -1 --format=%s "$target")"
changed="$(git_repo diff --name-only "$prev" "$target")"

if ! git_repo merge --ff-only -q "origin/$BRANCH"; then
  echo "$target" > "$STATE_DIR/failed-sha"
  notify "⚠️ Автодеплой: не удалось обновить код (история разошлась с GitHub). Нужно вмешательство."
  exit 1
fi

# Правки не в коде приложения (документы, задачи, станция) — пересборка не нужна
if ! echo "$changed" | grep -qE '^(backend|frontend|deploy)/'; then
  log "обновил код до ${target:0:7}, пересборка не нужна: $subject"
  exit 0
fi

# Страховка: дамп БД до выкатки (храним последние 10)
PRE_DIR="$STATE_DIR/predeploy"   # не в backups/: эта папка принадлежит контейнеру и недоступна обычному пользователю
mkdir -p "$PRE_DIR"
if dump_db "$PRE_DIR/crm-${target:0:7}-$(date +%F_%H%M).sql.gz"; then
  ls -1t "$PRE_DIR"/crm-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
else
  log "(страховочный дамп снять не удалось — продолжаю, дневной бэкап есть)"
fi

log "выкатываю ${target:0:7}: $subject"
build_log="$STATE_DIR/last-build.log"
if dc up -d --build >"$build_log" 2>&1; then
  healthy=0
  for _ in $(seq 1 45); do
    if backend_healthy; then healthy=1; break; fi
    sleep 2
  done
else
  healthy=0
fi

if [ "$healthy" -eq 1 ]; then
  rm -f "$STATE_DIR/failed-sha"
  notify "✅ Выкатил: $subject (${target:0:7})"
  exit 0
fi

# Не завелось — откат
echo "$target" > "$STATE_DIR/failed-sha"
git_repo reset -q --hard "$prev"
dc up -d --build >>"$build_log" 2>&1
if backend_healthy || { sleep 10; backend_healthy; }; then
  notify "↩️ Выкатка «$subject» (${target:0:7}) не завелась — откатил на ${prev:0:7}, CRM работает. Лог: $build_log"
else
  notify "🚨 CRM НЕ ОТВЕЧАЕТ после выкатки ${target:0:7} и после отката. Нужно зайти на сервер. Лог: $build_log"
fi
exit 1
