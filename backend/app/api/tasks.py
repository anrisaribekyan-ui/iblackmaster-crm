"""Задачи сотрудников (как «Задачи» в LiveSklad). Можно привязать к заказу.

Видимость по scope_of(me, "tasks"): none → 403; own → свои/назначенные; all → все
(с учётом location_ids(me), если у задачи есть location_id).
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_, select

from app.api.deps import CurrentEmployee, DbSession, check_location, has_permission, location_ids, require, scope_of
from app.db import utcnow
from app.errors import Forbidden, NotFound
from app.models import Employee, Order, Task
from app.services import orders as order_service

router = APIRouter(prefix="/tasks", tags=["Задачи"])

PAGE_SIZE = 50


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    text: str | None = None
    assignee_id: int | None = None
    deadline: datetime | None = None
    order_id: int | None = None
    location_id: int | None = None


class TaskUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    text: str | None = None
    assignee_id: int | None = None
    deadline: datetime | None = None


def _ensure_scope(me: CurrentEmployee) -> str:
    scope = scope_of(me, "tasks")
    if scope == "none":
        raise Forbidden("Нет доступа к задачам")
    return scope


def _visible_query(db: DbSession, me: CurrentEmployee):
    scope = _ensure_scope(me)
    query = select(Task).where(Task.is_deleted.is_(False))
    if scope == "own":
        query = query.where(or_(Task.author_id == me.id, Task.assignee_id == me.id))
    else:
        allowed = location_ids(me)
        if allowed:
            query = query.where(or_(Task.location_id.is_(None), Task.location_id.in_(allowed)))
    return query


def task_dict(db: DbSession, task: Task) -> dict:
    order = db.get(Order, task.order_id) if task.order_id else None
    author = db.get(Employee, task.author_id) if task.author_id else None
    assignee = db.get(Employee, task.assignee_id) if task.assignee_id else None
    return {
        "id": task.id,
        "title": task.title,
        "text": task.text,
        "location_id": task.location_id,
        "order_id": task.order_id,
        "order_number": order.number if order else None,
        "author_name": author.short_name if author else None,
        "assignee_id": task.assignee_id,
        "assignee_name": assignee.short_name if assignee else None,
        "deadline": task.deadline,
        "is_done": task.is_done,
        "done_at": task.done_at,
        "created_at": task.created_at,
    }


def _get_task(db: DbSession, me: CurrentEmployee, task_id: int) -> Task:
    task = db.get(Task, task_id)
    if task is None or task.is_deleted:
        raise NotFound("Задача")
    scope = _ensure_scope(me)
    if scope == "own" and task.author_id != me.id and task.assignee_id != me.id:
        raise NotFound("Задача")
    if scope != "own" and task.location_id is not None:
        allowed = location_ids(me)
        if allowed and task.location_id not in allowed and me.id not in (task.author_id, task.assignee_id):
            raise NotFound("Задача")
    return task


@router.get("")
def list_tasks(
    db: DbSession,
    me: CurrentEmployee,
    status: str = "all",
    assignee_id: int | None = None,
    order_id: int | None = None,
    page: int = Query(default=1, ge=1),
):
    query = _visible_query(db, me)
    if assignee_id is not None:
        query = query.where(Task.assignee_id == assignee_id)
    if order_id is not None:
        query = query.where(Task.order_id == order_id)

    if status == "open":
        query = query.where(Task.is_done.is_(False))
        query = query.order_by(Task.deadline.is_(None), Task.deadline, Task.created_at.desc())
    elif status == "overdue":
        query = query.where(Task.is_done.is_(False), Task.deadline.is_not(None), Task.deadline < utcnow())
        query = query.order_by(Task.deadline, Task.created_at.desc())
    elif status == "done":
        query = query.where(Task.is_done.is_(True))
        query = query.order_by(Task.done_at.desc(), Task.created_at.desc())
    else:
        query = query.order_by(Task.is_done, Task.deadline.is_(None), Task.deadline, Task.done_at.desc(), Task.created_at.desc())

    tasks = db.scalars(query).all()
    total = len(tasks)
    page_items = tasks[(max(page, 1) - 1) * PAGE_SIZE : max(page, 1) * PAGE_SIZE]
    return {"total": total, "items": [task_dict(db, task) for task in page_items]}


@router.post("", dependencies=[Depends(require("createTaskAccess"))])
def create_task(data: TaskCreate, db: DbSession, me: CurrentEmployee):
    location_id = data.location_id
    if data.order_id is not None:
        order = db.get(Order, data.order_id)
        if order is None or order.is_deleted:
            raise NotFound("Заказ")
        check_location(me, order.location_id)
        location_id = order.location_id
    elif location_id is not None:
        check_location(me, location_id)
    if data.assignee_id is not None and db.get(Employee, data.assignee_id) is None:
        raise NotFound("Исполнитель")

    task = Task(
        title=data.title.strip(),
        text=data.text,
        location_id=location_id,
        order_id=data.order_id,
        author_id=me.id,
        assignee_id=data.assignee_id,
        deadline=data.deadline,
    )
    db.add(task)
    if task.order_id is not None:
        order = db.get(Order, task.order_id)
        order_service.add_history(db, order, "comment", me, text=f"Задача: {task.title}")
    db.commit()
    return task_dict(db, task)


@router.put("/{task_id}")
def update_task(task_id: int, data: TaskUpdate, db: DbSession, me: CurrentEmployee):
    task = _get_task(db, me, task_id)
    if task.author_id != me.id and not has_permission(me, "changeAllTaskAccess"):
        raise Forbidden("Нет права редактировать чужую задачу")
    if data.assignee_id is not None and db.get(Employee, data.assignee_id) is None:
        raise NotFound("Исполнитель")
    task.title = data.title.strip()
    task.text = data.text
    task.assignee_id = data.assignee_id
    task.deadline = data.deadline
    db.commit()
    return task_dict(db, task)


def _change_done(task_id: int, db: DbSession, me: CurrentEmployee, done: bool):
    task = _get_task(db, me, task_id)
    if (
        task.author_id != me.id
        and task.assignee_id != me.id
        and not has_permission(me, "changeAllTaskAccess")
    ):
        raise Forbidden("Нет права менять чужую задачу")
    task.is_done = done
    task.done_at = utcnow() if done else None
    task.done_by_id = me.id if done else None
    if done and task.order_id is not None:
        order = db.get(Order, task.order_id)
        order_service.add_history(db, order, "comment", me, text=f"Задача выполнена: {task.title}")
    db.commit()
    return task_dict(db, task)


@router.post("/{task_id}/done")
def done_task(task_id: int, db: DbSession, me: CurrentEmployee):
    return _change_done(task_id, db, me, True)


@router.post("/{task_id}/reopen")
def reopen_task(task_id: int, db: DbSession, me: CurrentEmployee):
    return _change_done(task_id, db, me, False)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, db: DbSession, me: CurrentEmployee):
    task = _get_task(db, me, task_id)
    if task.author_id != me.id and not has_permission(me, "deleteAllTaskAccess"):
        raise Forbidden("Нет права удалять чужую задачу")
    task.is_deleted = True
    db.commit()

