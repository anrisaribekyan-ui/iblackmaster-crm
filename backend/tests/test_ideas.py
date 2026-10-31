"""Идеи для владельца: писать может любой сотрудник, читать и разбирать — только владелец."""

from tests.test_tasks import login, make_employee


def test_any_employee_sends_idea_only_owner_reads(client, db, auth_headers):
    make_employee(db, name="Лёша", email="lesha@x.test", permissions=[])
    worker = login(client, "lesha@x.test")

    r = client.post("/api/ideas", json={"text": "  Добавить кнопку печати  ", "page": "/orders"}, headers=worker)
    assert r.status_code == 201, r.text
    assert r.json()["text"] == "Добавить кнопку печати"
    assert r.json()["author"] == "Лёша"

    # пустую идею не принимаем
    assert client.post("/api/ideas", json={"text": "   "}, headers=worker).status_code == 400

    # сотрудник не видит чужие идеи и не разбирает их
    assert client.get("/api/ideas", headers=worker).status_code == 403
    assert client.get("/api/ideas/count", headers=worker).json() == {"new": 0}

    listing = client.get("/api/ideas", headers=auth_headers).json()
    assert listing["new"] == 1 and listing["items"][0]["author"] == "Лёша"
    idea_id = listing["items"][0]["id"]
    assert client.put(f"/api/ideas/{idea_id}", json={"status": "done"}, headers=worker).status_code == 403

    done = client.put(f"/api/ideas/{idea_id}", json={"status": "done", "note": "сделано"}, headers=auth_headers)
    assert done.status_code == 200 and done.json()["status"] == "done"
    assert client.get("/api/ideas/count", headers=auth_headers).json() == {"new": 0}
    assert client.get("/api/ideas?status=new", headers=auth_headers).json()["items"] == []
