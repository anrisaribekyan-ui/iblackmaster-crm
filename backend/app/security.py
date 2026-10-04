from datetime import timedelta

import bcrypt
import jwt

from app.config import settings
from app.db import utcnow


def hash_password(password: str, rounds: int = 12) -> str:
    # rounds=4 только для тестов и демо-данных — быстро, но слабо
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=rounds)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_access_token(employee_id: int) -> str:
    payload = {"sub": str(employee_id), "exp": utcnow() + timedelta(minutes=settings.jwt_expire_minutes)}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> int | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
