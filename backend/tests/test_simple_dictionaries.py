import pytest


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        ("/problems", {"name": "ДиагностикаAlpha"}),
        ("/complete-sets", {"name": "ДиагностикаAlpha"}),
        ("/measures", {"name": "ДиагностикаAlpha", "is_float": True}),
        ("/counteragent-types", {"name": "ДиагностикаAlpha", "sort": 10}),
    ],
)
def test_simple_dictionary_crud_and_case_insensitive_search(client, auth_headers, path, payload):
    response = client.post(f"/api{path}", json=payload, headers=auth_headers)
    assert response.status_code == 200
    item_id = response.json()["id"]

    response = client.get(f"/api{path}", params={"q": "ДИАГНОСТИКАalpha"}, headers=auth_headers)
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [item_id]

    updated_payload = {**payload, "name": "Обновлённая диагностика"}
    response = client.put(f"/api{path}/{item_id}", json=updated_payload, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["name"] == "Обновлённая диагностика"

    missing = client.put(f"/api{path}/999999", json=updated_payload, headers=auth_headers)
    assert missing.status_code == 404
    assert client.delete(f"/api{path}/{item_id}", headers=auth_headers).status_code == 204