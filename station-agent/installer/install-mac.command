#!/bin/bash
# Установка помощника станции на Mac: двойной щелчок по этому файлу.
# Рядом должны лежать iBlackMasterStation и ipatool (из архива сборки).
set -e
cd "$(dirname "$0")"
DEST="$HOME/Applications/iBlackMaster Station"

mkdir -p "$DEST"
# Останавливаем старого помощника так, чтобы launchd не поднял его со старым кодом
launchctl unload "$HOME/Library/LaunchAgents/ru.iblackmaster.station.plist" 2>/dev/null || true
pkill -f "iBlackMaster Station/iBlackMasterStation" 2>/dev/null || true
# Удаляем старые файлы, а не пишем поверх: на Apple Silicon перезапись подписанного файла
# в том же месте приводит к «Killed: 9» (система помнит подпись старого)
rm -f "$DEST/iBlackMasterStation" "$DEST/ipatool"
cp iBlackMasterStation ipatool "$DEST/"
chmod +x "$DEST/iBlackMasterStation" "$DEST/ipatool"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

PROMPT="Вставьте код подключения из CRM (Приложения → Подключить компьютер → «Скопировать код»):"
while true; do
  if ! CODE=$(osascript -e "text returned of (display dialog \"$PROMPT\" default answer \"\" with title \"iBlackMaster Station\")"); then
    # Отменили — возвращаем прежнего помощника, если он был
    launchctl load "$HOME/Library/LaunchAgents/ru.iblackmaster.station.plist" 2>/dev/null || true
    exit 0
  fi
  if OUT=$("$DEST/iBlackMasterStation" connect -- "$CODE" 2>&1); then
    break
  fi
  echo "$OUT"
  MSG=$(printf '%s' "$OUT" | tr '\n' ' ' | tr -d '"\\' | cut -c1-300)
  PROMPT="$MSG

Скопируйте код в CRM ещё раз и вставьте сюда:"
done
echo "$OUT"
"$DEST/iBlackMasterStation" autostart --enable
osascript -e 'display notification "Помощник запущен и будет стартовать сам" with title "iBlackMaster Station"'
