# Помощник станции (station-agent)

Программа на компьютере в точке, к которому по USB подключают айфоны. Держит связь с CRM
(раздел «Приложения»), читает приложения с донора, загружает покупки Apple ID, входит в Apple ID
и ставит приложения на телефоны. Всем управляют кнопками в CRM.

## Установка

**Windows** (нужен iTunes или Apple Devices — они дают драйвер айфона):
1. В CRM: «Приложения» → «Добавить станцию» → скопировать код подключения.
2. Скачать `iBlackMasterStation-Setup.exe` (GitHub → Actions → «Помощник станции» → Artifacts, или Releases).
3. Запустить, вставить код. Помощник стартует сам и при каждом входе в Windows.

**Mac:** скачать `iBlackMasterStation-Mac.zip`, распаковать, дважды щёлкнуть `install-mac.command`, вставить код.

## Как устроено
- `station/agent.py` — пульс (подключённые телефоны) и выполнение задач из CRM.
- `station/device.py` — айфоны через pymobiledevice3 (список, скан, установка).
- `station/ipatool.py` — Apple ID через [ipatool](https://github.com/majd/ipatool): вход, покупки, скачивание IPA с кэшем.
- `station/cli.py` — команды: `connect`, `run`, `status`, `autostart`, а для ручной проверки `devices`, `scan`, `purchases`, `download`, `install`, `transfer`.
- API в CRM: `backend/app/api/app_install.py` (заголовок `X-Station-Token`).

Настройки и журнал: `%APPDATA%\iBlackMaster Station` (Windows), `~/Library/Application Support/iBlackMaster Station` (Mac).
Пароль Apple ID нигде не сохраняется: ipatool хранит только токен сессии в системном хранилище.

## Разработка
```
pip install -r requirements.txt
python -m station connect <код>   # один раз
python -m station run
```
