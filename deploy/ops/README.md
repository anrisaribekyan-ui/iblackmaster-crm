# Обслуживание сервера: автодеплой, бэкап, восстановление

Скрипты запускаются **на хосте сервера** (не в контейнерах) таймерами systemd.

| Скрипт | Что делает | Когда |
|---|---|---|
| `autodeploy.sh` | Видит новый коммит в `main` → дамп БД «про запас» → `git pull` → `docker compose up -d --build` → проверка `/api/health`. Не завелось — откат на прошлую версию. Пишет в Telegram. | каждую минуту |
| `offsite-backup.sh` | Дамп БД + фото заказов + `.env` → шифрованные снимки restic в **каждое** хранилище из `RESTIC_REPOS`. Хранит 48 часовых, 30 суточных, 12 недельных, 12 месячных. | каждый час (в :15) |
| `restore.sh` | Поднимает CRM из последнего снимка (БД, фото, `.env`). | руками, когда беда |
| `restore.sh --test` | Разворачивает последний снимок во временную БД и сверяет данные. Живую CRM не трогает. | раз в месяц |

Бэкап, который ни разу не проверяли на восстановление, бэкапом не считается. Поэтому тест восстановления идёт сам и пишет результат в Telegram.

## Установка (один раз)

```bash
cd /home/anri/iblackmaster-crm && git pull
sudo deploy/ops/install-host.sh      # создаст deploy/ops.env и остановится
nano deploy/ops.env                  # заполнить (подсказки внутри)
sudo deploy/ops/install-host.sh      # теперь включит таймеры
sudo systemctl start crm-offsite-backup && journalctl -u crm-offsite-backup -n 30 --no-pager
sudo systemctl start crm-restore-test   && journalctl -u crm-restore-test -n 30 --no-pager
```

**Сохраните в менеджере паролей, вне сервера:** `RESTIC_PASSWORD`, адреса хранилищ и ключи S3. Без них бэкапы не открыть.

## Хранилища

**Свой VPS по SSH** (например 81.85.72.179):
```bash
# на VPS: пользователь без прав администратора и папка
sudo adduser --disabled-password --gecos "" backup && sudo mkdir -p /srv/crm-backups && sudo chown backup /srv/crm-backups
# на сервере CRM: ключ для root (бэкап работает от root) и запись в ssh-конфиге
sudo ssh-keygen -t ed25519 -N '' -f /root/.ssh/crm_backup
sudo cat /root/.ssh/crm_backup.pub        # → добавить в /home/backup/.ssh/authorized_keys на VPS
printf 'Host crm-backup-vps\n  HostName 81.85.72.179\n  User backup\n  IdentityFile /root/.ssh/crm_backup\n  StrictHostKeyChecking accept-new\n' | sudo tee -a /root/.ssh/config
# в ops.env: RESTIC_REPOS="sftp:crm-backup-vps:/srv/crm-backups"
```

**Yandex Object Storage** (Россия, 152-ФЗ): создайте бакет (стандартное хранение, доступ закрытый), сервисный аккаунт с ролью `storage.editor` на этот бакет и статический ключ доступа. В `ops.env`: `RESTIC_REPOS="... s3:https://storage.yandexcloud.net/ИМЯ_БАКЕТА"`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

Лучше оба хранилища сразу: тогда отказ одного не остановит бэкап, а потеря любого из них не страшна.

## Если сервер умер

1. Новый сервер (Ubuntu 24.04): `curl -fsSL https://get.docker.com | sh && sudo apt install -y restic git`
2. `git clone https://ТОКЕН@github.com/anrisaribekyan-ui/iblackmaster-crm.git ~/iblackmaster-crm`
3. Создайте `deploy/ops.env` из `ops.env.example`: нужны только `RESTIC_PASSWORD`, `RESTIC_REPOS` и ключи S3 (из менеджера паролей).
4. `cd ~/iblackmaster-crm/deploy/ops && sudo ./restore.sh` — вернёт `.env`, БД, фото и запустит CRM.
5. Направьте DNS-запись домена на новый IP, затем `sudo ./install-host.sh` включит автодеплой и бэкап.

Потеряете не больше часа данных; весь процесс занимает 10–15 минут, из которых большая часть сборка контейнеров.

Откатить базу на конкретный момент: `restic -r <хранилище> snapshots`, затем `./restore.sh --force --snapshot <id>`.

## Что смотреть, если что-то пошло не так

- Telegram: `✅ Бэкап CRM в порядке` приходит раз в сутки. **Если оно не пришло, бэкап не работает** (таймер, сервер или связь).
- `systemctl list-timers 'crm-*'` — расписание таймеров.
- `journalctl -u crm-autodeploy -n 50`, `journalctl -u crm-offsite-backup -n 50` — журналы.
- Лог последней сборки: `deploy/.ops-state/last-build.log`. Страховочные дампы перед выкаткой: `deploy/.ops-state/predeploy/` (последние 10).
- Автодеплой остановился с сообщением о «незакоммиченных правках» — на сервере есть ручные изменения кода: `git status`, закоммитьте или откатите их.
