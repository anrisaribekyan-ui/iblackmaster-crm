"""Общие фикстуры. Каждый тест получает свежую БД SQLite в памяти, заполненную сидом (demo)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

import app.models  # noqa: F401
from app.db import Base, get_db, make_engine
from app.main import app as fastapi_app
from app.models import Employee
from app.seed import seed


@pytest.fixture()
def db():
    engine = make_engine("sqlite://")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = Session()
    seed(session, demo=True)
    yield session
    session.close()
    engine.dispose()


@pytest.fixture()
def owner(db) -> Employee:
    return db.scalars(select(Employee).where(Employee.is_owner.is_(True))).one()


@pytest.fixture()
def client(db):
    def _get_db():
        yield db

    fastapi_app.dependency_overrides[get_db] = _get_db
    with TestClient(fastapi_app) as c:
        yield c
    fastapi_app.dependency_overrides.clear()


@pytest.fixture()
def auth_headers(client, owner):
    r = client.post("/api/auth/login", json={"email": owner.email, "password": "demo1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}
