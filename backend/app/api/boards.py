"""Доски как в Kaiten/Trello: пространство → доски → колонки → карточки.

Доступ — тот же, что к задачам: scope_of(me, "tasks") != "none". Пространство с location_id
видят только сотрудники этой локации. Структуру (пространства, доски, колонки) меняют с правом
createTaskAccess; карточки — все, у кого есть доступ; удалить чужую карточку — deleteAllTaskAccess.
Удаление везде мягкое (is_archived).
"""

from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.api.deps import CurrentEmployee, DbSession, check_location, has_permission, location_ids, require, scope_of
from app.errors import Forbidden, NotFound
from app.models import Board, BoardColumn, BoardSpace, Card, CardComment, Employee, Order

router = APIRouter(prefix="/boards", tags=["Доски"])

COLOR = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


# --- Доступ ------------------------------------------------------------------------


def _access(me: Employee) -> None:
    if scope_of(me, "tasks") == "none":
        raise Forbidden("Нет доступа к доскам")


def _space(db: DbSession, me: Employee, space_id: int) -> BoardSpace:
    _access(me)
    space = db.get(BoardSpace, space_id)
    if space is None or space.is_archived:
        raise NotFound("Пространство")
    if space.location_id is not None:
        check_location(me, space.location_id)
    return space


def _board(db: DbSession, me: Employee, board_id: int) -> Board:
    board = db.get(Board, board_id)
    if board is None or board.is_archived:
        raise NotFound("Доска")
    _space(db, me, board.space_id)
    return board


def _column(db: DbSession, me: Employee, column_id: int) -> BoardColumn:
    column = db.get(BoardColumn, column_id)
    if column is None or column.is_archived:
        raise NotFound("Колонка")
    _board(db, me, column.board_id)
    return column


def _card(db: DbSession, me: Employee, card_id: int) -> Card:
    card = db.get(Card, card_id)
    if card is None or card.is_archived:
        raise NotFound("Карточка")
    _column(db, me, card.column_id)
    return card


def _reorder(items: list, moved, index: int) -> None:
    """Ставит moved на позицию index и перенумеровывает sort = 0, 1, 2…"""
    rest = [item for item in items if item.id != moved.id]
    index = max(0, min(index, len(rest)))
    rest.insert(index, moved)
    for number, item in enumerate(rest):
        item.sort = number


def _active_cards(db: DbSession, column_id: int) -> list[Card]:
    return list(
        db.scalars(
            select(Card).where(Card.column_id == column_id, Card.is_archived.is_(False)).order_by(Card.sort, Card.id)
        )
    )


def _names(db: DbSession, ids: set[int]) -> dict[int, str]:
    ids.discard(None)
    if not ids:
        return {}
    return {e.id: e.short_name for e in db.scalars(select(Employee).where(Employee.id.in_(ids)))}


def card_short(card: Card, names: dict[int, str], orders: dict[int, str], comments: dict[int, int]) -> dict:
    done = sum(1 for item in card.checklist or [] if item.get("done"))
    return {
        "id": card.id,
        "column_id": card.column_id,
        "title": card.title,
        "color": card.color,
        "sort": card.sort,
        "assignee_id": card.assignee_id,
        "assignee_name": names.get(card.assignee_id),
        "deadline": card.deadline,
        "order_id": card.order_id,
        "order_number": orders.get(card.order_id),
        "has_text": bool(card.text),
        "checklist_done": done,
        "checklist_total": len(card.checklist or []),
        "comments": comments.get(card.id, 0),
    }


# --- Пространства ------------------------------------------------------------------


class SpaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    location_id: int | None = None
    sort: int = 0


@router.get("/spaces")
def list_spaces(db: DbSession, me: CurrentEmployee):
    _access(me)
    query = select(BoardSpace).where(BoardSpace.is_archived.is_(False))
    allowed = location_ids(me)
    if allowed:
        query = query.where(or_(BoardSpace.location_id.is_(None), BoardSpace.location_id.in_(allowed)))
    spaces = db.scalars(query.order_by(BoardSpace.sort, BoardSpace.id)).all()
    counts = dict(
        db.execute(
            select(Board.space_id, func.count(Card.id))
            .join(BoardColumn, BoardColumn.board_id == Board.id)
            .join(Card, Card.column_id == BoardColumn.id)
            .where(Card.is_archived.is_(False), BoardColumn.is_archived.is_(False), Board.is_archived.is_(False))
            .group_by(Board.space_id)
        ).all()
    )
    return [
        {"id": s.id, "name": s.name, "location_id": s.location_id, "sort": s.sort, "cards": counts.get(s.id, 0)}
        for s in spaces
    ]


@router.post("/spaces", dependencies=[Depends(require("createTaskAccess"))])
def create_space(data: SpaceIn, db: DbSession, me: CurrentEmployee):
    _access(me)
    if data.location_id is not None:
        check_location(me, data.location_id)
    space = BoardSpace(name=data.name.strip(), location_id=data.location_id, sort=data.sort)
    db.add(space)
    db.flush()
    # Как в Kaiten: новое пространство сразу с доской и колонкой, чтобы можно было писать задачи
    board = Board(space_id=space.id, name=space.name)
    db.add(board)
    db.flush()
    db.add(BoardColumn(board_id=board.id, name="Новые"))
    db.commit()
    return {"id": space.id, "name": space.name}


@router.put("/spaces/{space_id}", dependencies=[Depends(require("createTaskAccess"))])
def update_space(space_id: int, data: SpaceIn, db: DbSession, me: CurrentEmployee):
    space = _space(db, me, space_id)
    if data.location_id is not None:
        check_location(me, data.location_id)
    space.name, space.location_id, space.sort = data.name.strip(), data.location_id, data.sort
    db.commit()
    return {"id": space.id, "name": space.name}


@router.delete("/spaces/{space_id}", status_code=204, dependencies=[Depends(require("createTaskAccess"))])
def archive_space(space_id: int, db: DbSession, me: CurrentEmployee):
    _space(db, me, space_id).is_archived = True
    db.commit()


@router.get("/spaces/{space_id}")
def get_space(space_id: int, db: DbSession, me: CurrentEmployee):
    """Всё пространство одним запросом: доски → колонки → карточки (как экран Kaiten)."""
    space = _space(db, me, space_id)
    boards = [b for b in space.boards if not b.is_archived]
    columns = [c for b in boards for c in b.columns if not c.is_archived]
    cards = (
        db.scalars(
            select(Card)
            .where(Card.column_id.in_([c.id for c in columns] or [0]), Card.is_archived.is_(False))
            .order_by(Card.sort, Card.id)
        ).all()
    )
    names = _names(db, {c.assignee_id for c in cards})
    order_ids = {c.order_id for c in cards if c.order_id}
    orders = {o.id: o.number for o in db.scalars(select(Order).where(Order.id.in_(order_ids or {0})))}
    comments = dict(
        db.execute(
            select(CardComment.card_id, func.count()).where(CardComment.card_id.in_([c.id for c in cards] or [0])).group_by(CardComment.card_id)
        ).all()
    )
    by_column: dict[int, list] = {}
    for card in cards:
        by_column.setdefault(card.column_id, []).append(card_short(card, names, orders, comments))
    return {
        "id": space.id,
        "name": space.name,
        "location_id": space.location_id,
        "boards": [
            {
                "id": b.id,
                "name": b.name,
                "sort": b.sort,
                "columns": [
                    {"id": c.id, "name": c.name, "sort": c.sort, "cards": by_column.get(c.id, [])}
                    for c in b.columns
                    if not c.is_archived
                ],
            }
            for b in boards
        ],
    }


# --- Доски и колонки ---------------------------------------------------------------


class NameIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class MoveIn(BaseModel):
    index: int = Field(ge=0)


@router.post("/spaces/{space_id}/boards", dependencies=[Depends(require("createTaskAccess"))])
def create_board(space_id: int, data: NameIn, db: DbSession, me: CurrentEmployee):
    space = _space(db, me, space_id)
    sort = (db.scalar(select(func.max(Board.sort)).where(Board.space_id == space.id)) or 0) + 1
    board = Board(space_id=space.id, name=data.name.strip(), sort=sort)
    db.add(board)
    db.flush()
    db.add(BoardColumn(board_id=board.id, name="Новые"))
    db.commit()
    return {"id": board.id, "name": board.name}


@router.put("/{board_id}", dependencies=[Depends(require("createTaskAccess"))])
def rename_board(board_id: int, data: NameIn, db: DbSession, me: CurrentEmployee):
    board = _board(db, me, board_id)
    board.name = data.name.strip()
    db.commit()
    return {"id": board.id, "name": board.name}


@router.post("/{board_id}/move", dependencies=[Depends(require("createTaskAccess"))])
def move_board(board_id: int, data: MoveIn, db: DbSession, me: CurrentEmployee):
    board = _board(db, me, board_id)
    siblings = list(db.scalars(select(Board).where(Board.space_id == board.space_id, Board.is_archived.is_(False)).order_by(Board.sort, Board.id)))
    _reorder(siblings, board, data.index)
    db.commit()
    return {"ok": True}


@router.delete("/{board_id}", status_code=204, dependencies=[Depends(require("createTaskAccess"))])
def archive_board(board_id: int, db: DbSession, me: CurrentEmployee):
    _board(db, me, board_id).is_archived = True
    db.commit()


@router.post("/{board_id}/columns", dependencies=[Depends(require("createTaskAccess"))])
def create_column(board_id: int, data: NameIn, db: DbSession, me: CurrentEmployee):
    board = _board(db, me, board_id)
    sort = (db.scalar(select(func.max(BoardColumn.sort)).where(BoardColumn.board_id == board.id)) or 0) + 1
    column = BoardColumn(board_id=board.id, name=data.name.strip(), sort=sort)
    db.add(column)
    db.commit()
    return {"id": column.id, "name": column.name}


@router.put("/columns/{column_id}", dependencies=[Depends(require("createTaskAccess"))])
def rename_column(column_id: int, data: NameIn, db: DbSession, me: CurrentEmployee):
    column = _column(db, me, column_id)
    column.name = data.name.strip()
    db.commit()
    return {"id": column.id, "name": column.name}


@router.post("/columns/{column_id}/move", dependencies=[Depends(require("createTaskAccess"))])
def move_column(column_id: int, data: MoveIn, db: DbSession, me: CurrentEmployee):
    column = _column(db, me, column_id)
    siblings = list(db.scalars(select(BoardColumn).where(BoardColumn.board_id == column.board_id, BoardColumn.is_archived.is_(False)).order_by(BoardColumn.sort, BoardColumn.id)))
    _reorder(siblings, column, data.index)
    db.commit()
    return {"ok": True}


@router.delete("/columns/{column_id}", status_code=204, dependencies=[Depends(require("createTaskAccess"))])
def archive_column(column_id: int, db: DbSession, me: CurrentEmployee):
    _column(db, me, column_id).is_archived = True
    db.commit()


# --- Карточки ----------------------------------------------------------------------


class QuickCardIn(BaseModel):
    title: str = Field(min_length=1, max_length=5000)


class ChecklistItem(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    done: bool = False


class CardIn(BaseModel):
    title: str = Field(min_length=1, max_length=5000)
    text: str | None = None
    color: str | None = COLOR
    assignee_id: int | None = None
    deadline: datetime | None = None
    order_id: int | None = None
    checklist: list[ChecklistItem] = Field(default_factory=list)


class CardMoveIn(BaseModel):
    column_id: int
    index: int = Field(ge=0)


@router.post("/columns/{column_id}/cards")
def create_card(column_id: int, data: QuickCardIn, db: DbSession, me: CurrentEmployee):
    """Поле «Сформулируйте задачу» внизу колонки: карточка встаёт в конец."""
    column = _column(db, me, column_id)
    sort = (db.scalar(select(func.max(Card.sort)).where(Card.column_id == column.id, Card.is_archived.is_(False))) or 0) + 1
    card = Card(column_id=column.id, title=data.title.strip(), sort=sort, author_id=me.id, checklist=[])
    db.add(card)
    db.commit()
    return card_short(card, {}, {}, {})


@router.get("/cards/{card_id}")
def get_card(card_id: int, db: DbSession, me: CurrentEmployee):
    card = _card(db, me, card_id)
    comments = db.scalars(select(CardComment).where(CardComment.card_id == card.id).order_by(CardComment.created_at)).all()
    names = _names(db, {card.author_id, card.assignee_id, *(c.author_id for c in comments)})
    order = db.get(Order, card.order_id) if card.order_id else None
    column = db.get(BoardColumn, card.column_id)
    return {
        **card_short(card, names, {order.id: order.number} if order else {}, {card.id: len(comments)}),
        "text": card.text,
        "checklist": card.checklist or [],
        "author_name": names.get(card.author_id),
        "board_id": column.board_id,
        "column_name": column.name,
        "created_at": card.created_at,
        "updated_at": card.updated_at,
        "comment_list": [
            {"id": c.id, "author_name": names.get(c.author_id), "text": c.text, "created_at": c.created_at} for c in comments
        ],
    }


@router.put("/cards/{card_id}")
def update_card(card_id: int, data: CardIn, db: DbSession, me: CurrentEmployee):
    card = _card(db, me, card_id)
    if data.assignee_id is not None and db.get(Employee, data.assignee_id) is None:
        raise NotFound("Исполнитель")
    if data.order_id is not None:
        order = db.get(Order, data.order_id)
        if order is None or order.is_deleted:
            raise NotFound("Заказ")
        check_location(me, order.location_id)
    card.title = data.title.strip()
    card.text = data.text
    card.color = data.color
    card.assignee_id = data.assignee_id
    card.deadline = data.deadline
    card.order_id = data.order_id
    card.checklist = [item.model_dump() for item in data.checklist]
    db.commit()
    return get_card(card.id, db, me)


@router.post("/cards/{card_id}/move")
def move_card(card_id: int, data: CardMoveIn, db: DbSession, me: CurrentEmployee):
    """Перетаскивание: в другую колонку (в т.ч. на другую доску пространства) на позицию index."""
    card = _card(db, me, card_id)
    source = db.get(BoardColumn, card.column_id)
    target = _column(db, me, data.column_id)
    if db.get(Board, target.board_id).space_id != db.get(Board, source.board_id).space_id:
        raise Forbidden("Карточку можно перенести только внутри пространства")
    old_column = card.column_id
    card.column_id = target.id
    _reorder(_active_cards(db, target.id), card, data.index)
    if old_column != target.id:
        for number, item in enumerate(c for c in _active_cards(db, old_column) if c.id != card.id):
            item.sort = number
    db.commit()
    return {"ok": True}


@router.delete("/cards/{card_id}", status_code=204)
def archive_card(card_id: int, db: DbSession, me: CurrentEmployee):
    card = _card(db, me, card_id)
    if card.author_id != me.id and not has_permission(me, "deleteAllTaskAccess"):
        raise Forbidden("Нет права удалять чужие карточки")
    card.is_archived = True
    db.commit()


class CommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


@router.post("/cards/{card_id}/comments")
def add_comment(card_id: int, data: CommentIn, db: DbSession, me: CurrentEmployee):
    card = _card(db, me, card_id)
    comment = CardComment(card_id=card.id, author_id=me.id, text=data.text.strip())
    db.add(comment)
    db.commit()
    return {"id": comment.id, "author_name": me.short_name, "text": comment.text, "created_at": comment.created_at}


@router.get("/search")
def search_cards(q: str, db: DbSession, me: CurrentEmployee):
    """Поиск по всем доступным пространствам (лупа в шапке Kaiten)."""
    _access(me)
    allowed = location_ids(me)
    query = (
        select(Card, BoardColumn, Board, BoardSpace)
        .join(BoardColumn, BoardColumn.id == Card.column_id)
        .join(Board, Board.id == BoardColumn.board_id)
        .join(BoardSpace, BoardSpace.id == Board.space_id)
        .where(
            Card.is_archived.is_(False),
            BoardColumn.is_archived.is_(False),
            Board.is_archived.is_(False),
            BoardSpace.is_archived.is_(False),
            or_(Card.title.ilike(f"%{q}%"), Card.text.ilike(f"%{q}%")),
        )
    )
    if allowed:
        query = query.where(or_(BoardSpace.location_id.is_(None), BoardSpace.location_id.in_(allowed)))
    rows = db.execute(query.order_by(Card.updated_at.desc()).limit(50)).all()
    return [
        {"id": card.id, "title": card.title, "space_id": space.id, "space_name": space.name, "board_name": board.name, "column_name": column.name}
        for card, column, board, space in rows
    ]
