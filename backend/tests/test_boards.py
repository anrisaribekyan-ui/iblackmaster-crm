"""Доски (аналог Kaiten): пространства, доски, колонки, карточки, перетаскивание, права."""

from app.models import Employee, Role
from app.security import hash_password


def login(client, db, email, permissions, scopes):
    employee = Employee(name=email, short_name=email, email=email,
                        password_hash=hash_password("password123", rounds=4),
                        role=Role(name=email, permissions=permissions, scopes=scopes))
    db.add(employee)
    db.commit()
    token = client.post("/api/auth/login", json={"email": email, "password": "password123"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_space_board_columns_cards_flow(client, auth_headers):
    space = client.post("/api/boards/spaces", json={"name": "Панфа"}, headers=auth_headers).json()
    detail = client.get(f"/api/boards/spaces/{space['id']}", headers=auth_headers).json()
    assert detail["boards"][0]["name"] == "Панфа"
    board_id = detail["boards"][0]["id"]
    first_column = detail["boards"][0]["columns"][0]["id"]
    client.put(f"/api/boards/columns/{first_column}", json={"name": "Что нужно в панфу"}, headers=auth_headers)
    queue = client.post(f"/api/boards/{board_id}/columns", json={"name": "Очередь"}, headers=auth_headers).json()

    titles = ["Дисплей Redmi Note 12 Pro", "Крышка Honor 20 Lite", "Remax 17 pro"]
    cards = [client.post(f"/api/boards/columns/{first_column}/cards", json={"title": t}, headers=auth_headers).json() for t in titles]
    # Перетаскиваем вторую карточку в «Очередь», затем третью наверх первой колонки
    assert client.post(f"/api/boards/cards/{cards[1]['id']}/move", json={"column_id": queue["id"], "index": 0}, headers=auth_headers).status_code == 200
    client.post(f"/api/boards/cards/{cards[2]['id']}/move", json={"column_id": first_column, "index": 0}, headers=auth_headers)

    detail = client.get(f"/api/boards/spaces/{space['id']}", headers=auth_headers).json()
    columns = {c["name"]: [card["title"] for card in c["cards"]] for c in detail["boards"][0]["columns"]}
    assert columns == {"Что нужно в панфу": ["Remax 17 pro", "Дисплей Redmi Note 12 Pro"], "Очередь": ["Крышка Honor 20 Lite"]}

    updated = client.put(f"/api/boards/cards/{cards[0]['id']}", headers=auth_headers, json={
        "title": "Дисплей Redmi Note 12 Pro 4G", "text": "moba 4830", "color": "#9c27b0",
        "checklist": [{"text": "Заказать", "done": True}, {"text": "Получить"}]})
    assert updated.status_code == 200, updated.text
    assert updated.json()["checklist_done"] == 1 and updated.json()["checklist_total"] == 2
    client.post(f"/api/boards/cards/{cards[0]['id']}/comments", json={"text": "Заказал"}, headers=auth_headers)
    assert client.get(f"/api/boards/cards/{cards[0]['id']}", headers=auth_headers).json()["comment_list"][0]["text"] == "Заказал"

    found = client.get("/api/boards/search?q=moba", headers=auth_headers).json()
    assert [f["id"] for f in found] == [cards[0]["id"]]
    assert client.get("/api/boards/spaces", headers=auth_headers).json()[0]["cards"] == 3

    assert client.delete(f"/api/boards/cards/{cards[0]['id']}", headers=auth_headers).status_code == 204
    assert client.get(f"/api/boards/cards/{cards[0]['id']}", headers=auth_headers).status_code == 404


def test_rights(client, db, auth_headers):
    space = client.post("/api/boards/spaces", json={"name": "Тыща"}, headers=auth_headers).json()
    column = client.get(f"/api/boards/spaces/{space['id']}", headers=auth_headers).json()["boards"][0]["columns"][0]["id"]
    owner_card = client.post(f"/api/boards/columns/{column}/cards", json={"title": "Флешка 32гб"}, headers=auth_headers).json()

    worker = login(client, db, "worker@example.test", [], {"tasks": "own"})
    assert client.post("/api/boards/spaces", json={"name": "Своё"}, headers=worker).status_code == 403  # структура — только с правом
    assert client.post(f"/api/boards/columns/{column}/cards", json={"title": "Стекло камеры"}, headers=worker).status_code == 200
    assert client.delete(f"/api/boards/cards/{owner_card['id']}", headers=worker).status_code == 403

    nobody = login(client, db, "nobody@example.test", [], {"tasks": "none"})
    assert client.get("/api/boards/spaces", headers=nobody).status_code == 403
