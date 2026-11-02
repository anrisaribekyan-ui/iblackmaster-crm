"""Склейка клиентов, задвоенных переносом; разбор нескольких телефонов в одной ячейке."""

from sqlalchemy import select

from app.models import Counteragent
from app.services.client_merge import merge_duplicates
from app.utils.phone import split_phones


def test_split_phones():
    assert split_phones("79686263248,79916436070") == ["79686263248", "79916436070"]
    assert split_phones("7968626324879916436070") == ["79686263248", "79916436070"]
    assert split_phones("+7 (968) 626-32-48; 8 991 643-60-70") == ["79686263248", "79916436070"]
    assert split_phones("") == []


def test_merge_duplicates(db):
    old = Counteragent(name="Абрамкин Антон", phones="79686263248,79916436070")
    dup = Counteragent(name="Абрамкин Антон", phones="7968626324879916436070")
    other = Counteragent(name="Другой", phones="79990000000")
    db.add_all([old, dup, other])
    db.commit()
    dup_id = dup.id
    assert merge_duplicates(db, commit=False)["pairs"] == 1
    assert db.get(Counteragent, dup_id) is not None
    result = merge_duplicates(db, commit=True)
    assert result["pairs"] == 1
    assert db.get(Counteragent, dup_id) is None
    assert len(db.scalars(select(Counteragent)).all()) == 2
    assert merge_duplicates(db, commit=True)["pairs"] == 0
