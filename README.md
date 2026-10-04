# iBlackMaster CRM

Собственная CRM для сервисных центров iBlackMaster на замену LiveSklad.

- Бэкенд: Python 3.12+, FastAPI, SQLAlchemy 2, PostgreSQL (в разработке — SQLite)
- Фронтенд: React 19, TypeScript, Vite, Tailwind 4
- ТЗ: https://claude.ai/code/artifact/039c4a1b-77d7-44ba-a9bc-71ed0862b977
- Техническая спецификация: [docs/SPEC.md](docs/SPEC.md)
- Задачи: [TASKS.md](TASKS.md) · Правила для ИИ-помощника: [.clinerules](.clinerules)

## Запуск на своём компьютере

Нужны Python 3.12+ и Node.js 20+.

```bash
# Бэкенд
cd backend
pip install -r requirements.txt
python -m app.seed --demo        # заполнить БД настройками из LiveSklad (вход: anrisar@my.com / demo1234)
python -m uvicorn app.main:app --reload    # http://127.0.0.1:8000/docs — документация API

# Фронтенд (во втором терминале)
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

Тесты: `cd backend && python -m pytest -q`

## Как устроена работа

1. Claude пишет архитектуру, модели данных и всё, что связано с деньгами (кассы, склад, зарплата).
2. DeepSeek в Cline выполняет задачи из TASKS.md по правилам из .clinerules: одна задача — один коммит.
3. Claude проверяет пачку коммитов, исправляет и ставит отметку `[R]`.

## Структура

```
backend/app/
  models/        модели БД (не трогать без Claude)
  services/      бизнес-логика: money.py, stock.py, orders.py (не трогать без Claude)
  api/           роутеры FastAPI (образец — how_knows.py)
  permissions.py права ролей 1-в-1 как в LiveSklad
  seed_data.json настройки, снятые с LiveSklad
frontend/src/
  api/client.ts  клиент API
  auth.tsx       вход и права
  pages/         страницы (образец — HowKnowsPage.tsx)
```
