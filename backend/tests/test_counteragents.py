from app.models import Counteragent


def test_counteragent_search_normalizes_phone_and_by_phone(client, auth_headers, db):
    item = Counteragent(name="Иван", phones="79161866119")
    db.add(item)
    db.commit()

    response = client.get("/api/counteragents", params={"q": "8 (916) 186-61-19"}, headers=auth_headers)
    assert response.status_code == 200
    assert [entry["id"] for entry in response.json()["items"]] == [item.id]

    response = client.get("/api/counteragents/by-phone", params={"phone": "+7 916 1866119"}, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["id"] == item.id


def test_counteragent_input_cannot_set_balance(client, auth_headers, db):
    response = client.post(
        "/api/counteragents",
        json={"name": "Новый клиент", "phones": "8 (916) 186-61-19", "balance": "12345.67"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert response.json()["phones"] == "79161866119"
    assert response.json()["balance"] == "0"
    assert db.get(Counteragent, response.json()["id"]).balance == 0