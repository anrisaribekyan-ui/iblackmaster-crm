#!/usr/bin/env bash
# Тестовый запуск CRM на сервере, где 80/443 заняты (VPN): http://IP:8080, демо-данные.
# Запуск на сервере: cd /opt/crm/deploy && bash test-server.sh
set -euo pipefail
cd "$(dirname "$0")"
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
if [ ! -f .env ]; then
  cat > .env <<ENV
DOMAIN=:80
HTTP_PORT=8080
HTTPS_PORT=8443
DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
REGISTRY=docker.io/library
ENV
fi
docker compose up -d --build
echo "Ждём запуск бэкенда…"
for i in $(seq 1 60); do
  if docker compose exec -T backend python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health')" 2>/dev/null; then break; fi
  sleep 2
done
docker compose exec -T backend python -m app.seed --demo || true
IP=$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
echo
echo "Готово: http://$IP:8080   вход anrisar@my.com / demo1234"
