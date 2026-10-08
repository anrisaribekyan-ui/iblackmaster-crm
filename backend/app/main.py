from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import app.models  # noqa: F401  — регистрирует все таблицы
from app.api import (
    auth,
    notifications as notifications_api,
    boards,
    cash_registers,
    complete_sets,
    counteragents,
    counteragent_types,
    dashboard,
    devices,
    how_knows,
    locations,
    measures,
    nomenclature,
    order_types,
    order_statuses,
    orders,
    problems,
    reports,
    salary,
    staff,
    stock_remains,
    stock_documents,
    sales,
    tasks,
    transactions,
    stores,
)
from app.config import settings
from app.db import Base, SessionLocal, engine
from app.services import notifications
from app.errors import BusinessError

STATUS_BY_CODE = {"not_found": 404, "forbidden": 403, "unauthorized": 401, "bad_credentials": 401}


@asynccontextmanager
async def lifespan(_: FastAPI):
    # SQLite (разработка) — таблицы создаются сами. PostgreSQL (сервер) — только через миграции:
    # alembic upgrade head (делает entrypoint контейнера).
    if engine.dialect.name == "sqlite":
        Base.metadata.create_all(engine)
    elif settings.jwt_secret == "change-me-in-production" or len(settings.jwt_secret) < 32:
        raise RuntimeError("Задайте JWT_SECRET длиной от 32 символов (openssl rand -hex 32)")
    notifications.start_worker(SessionLocal)  # SMS-очередь; ничего не делает, если шлюз не настроен
    yield


app = FastAPI(title="iBlackMaster CRM", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(BusinessError)
async def business_error_handler(_: Request, exc: BusinessError):
    return JSONResponse(
        status_code=STATUS_BY_CODE.get(exc.code, 400),
        content={"error": exc.code, "message": exc.message},
    )


@app.get("/api/health")
def health():
    return {"ok": True}


# Все роутеры подключаются с префиксом /api. Новый роутер — добавь строку сюда.
app.include_router(auth.router, prefix="/api")
app.include_router(how_knows.router, prefix="/api")
app.include_router(locations.router, prefix="/api")
app.include_router(stores.router, prefix="/api")
app.include_router(cash_registers.router, prefix="/api")
app.include_router(order_types.router, prefix="/api")
app.include_router(order_statuses.router, prefix="/api")
app.include_router(staff.router, prefix="/api")
app.include_router(problems.router, prefix="/api")
app.include_router(complete_sets.router, prefix="/api")
app.include_router(measures.router, prefix="/api")
app.include_router(counteragent_types.router, prefix="/api")
app.include_router(devices.router, prefix="/api")
app.include_router(nomenclature.router, prefix="/api")
app.include_router(counteragents.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(orders.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(boards.router, prefix="/api")
app.include_router(notifications_api.router, prefix="/api")
app.include_router(salary.router, prefix="/api")
app.include_router(stock_documents.router, prefix="/api")
app.include_router(stock_remains.router, prefix="/api")
app.include_router(sales.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(transactions.router, prefix="/api")
