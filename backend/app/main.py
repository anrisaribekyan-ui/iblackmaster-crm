from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import app.models  # noqa: F401  — регистрирует все таблицы
from app.api import auth, how_knows, locations, stores
from app.db import Base, engine
from app.errors import BusinessError

STATUS_BY_CODE = {"not_found": 404, "forbidden": 403, "unauthorized": 401, "bad_credentials": 401}


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Этап 1: таблицы создаются автоматически. Перед боевым запуском переходим на Alembic (задача T-40).
    Base.metadata.create_all(engine)
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
