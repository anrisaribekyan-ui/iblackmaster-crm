# Запуск CRM на сервере

Нужен VPS в России (152-ФЗ: персональные данные клиентов храним в РФ):
Ubuntu 24.04, 2 vCPU, 4 ГБ RAM, 40+ ГБ SSD. И домен/поддомен, например `crm.iblackmaster.ru`.

## 1. DNS
У регистратора домена создайте A-запись: `crm` → IP сервера. Подождите 5–30 минут.

## 2. Сервер (один раз)
```bash
ssh root@IP_СЕРВЕРА
curl -fsSL https://get.docker.com | sh          # Docker
git clone https://github.com/anrisaribekyan-ui/iblackmaster-crm.git /opt/crm
cd /opt/crm/deploy
cp .env.example .env
sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=$(openssl rand -hex 24)/; s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
nano .env                                        # вписать DOMAIN=crm.ваш-домен.ru
docker compose up -d --build
```
Репозиторий приватный: для `git clone` нужен токен GitHub (Settings → Developer settings → Personal access tokens,
доступ только на чтение этого репозитория) — `git clone https://ТОКЕН@github.com/...`.

## 3. Первое заполнение
```bash
docker compose exec backend python -m app.seed
```
Спросит пароль владельца, остальным сотрудникам выдаст случайные пароли — сохраните их.
Откройте `https://crm.ваш-домен.ru` — сертификат HTTPS Caddy получит сам за минуту.

## Обновление
```bash
cd /opt/crm && git pull && cd deploy && docker compose up -d --build
```
Миграции БД применяются автоматически при старте бэкенда.

## Бэкапы
Каждые сутки в `/opt/crm/deploy/backups/` (хранятся 14 дней). Раз в неделю копируйте их куда-то ещё
(другой сервер, облако) — бэкап на том же диске не спасёт, если умрёт сервер.

Восстановление: `gunzip -c backups/crm-ДАТА.sql.gz | docker compose exec -T db psql -U crm crm`

## Если не скачиваются образы Docker
Docker Hub может быть недоступен с российских серверов. Укажите в `.env` зеркало, которое даёт хостинг:
`REGISTRY=<адрес-зеркала>/library`.
