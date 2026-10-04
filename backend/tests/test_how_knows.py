"""ОБРАЗЕЦ API-теста. Новые роутеры тестируй по этому шаблону."""


def test_how_knows_crud(client, auth_headers):
    r = client.get("/api/how-knows", headers=auth_headers)
    assert r.status_code == 200
    names = [x["name"] for x in r.json()]
    assert "Авито" in names

    r = client.post("/api/how-knows", json={"name": "2ГИС"}, headers=auth_headers)
    assert r.status_code == 200
    item_id = r.json()["id"]

    r = client.put(f"/api/how-knows/{item_id}", json={"name": "2GIS"}, headers=auth_headers)
    assert r.json()["name"] == "2GIS"

    assert client.delete(f"/api/how-knows/{item_id}", headers=auth_headers).status_code == 204
    names = [x["name"] for x in client.get("/api/how-knows", headers=auth_headers).json()]
    assert "2GIS" not in names


def test_requires_login(client):
    r = client.get("/api/how-knows")
    assert r.status_code == 401


def test_validation_error_on_empty_name(client, auth_headers):
    r = client.post("/api/how-knows", json={"name": ""}, headers=auth_headers)
    assert r.status_code == 422
