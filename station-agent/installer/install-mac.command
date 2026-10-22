#!/bin/bash
# Установка помощника станции на Mac: двойной щелчок по этому файлу.
# Рядом должны лежать iBlackMasterStation и ipatool (из архива сборки).
set -e
cd "$(dirname "$0")"
DEST="$HOME/Applications/iBlackMaster Station"

CODE=$(osascript -e 'text returned of (display dialog "Вставьте код подключения из CRM (Приложения → Добавить станцию):" default answer "" with title "iBlackMaster Station")') || exit 0

mkdir -p "$DEST"
pkill -f "iBlackMaster Station/iBlackMasterStation" 2>/dev/null || true
cp iBlackMasterStation ipatool "$DEST/"
chmod +x "$DEST/iBlackMasterStation" "$DEST/ipatool"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

if ! "$DEST/iBlackMasterStation" connect "$CODE"; then
  osascript -e 'display alert "Не получилось подключить станцию" message "Проверьте код и интернет, затем запустите установку ещё раз."'
  exit 1
fi
"$DEST/iBlackMasterStation" autostart --enable
osascript -e 'display notification "Помощник запущен и будет стартовать сам" with title "iBlackMaster Station"'
