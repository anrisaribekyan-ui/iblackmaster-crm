from app.models import Brand, DeviceModel


def test_device_tree_crud_and_filters(client, auth_headers):
    response = client.post("/api/device-types", json={"name": "Телефон"}, headers=auth_headers)
    assert response.status_code == 200
    device_type_id = response.json()["id"]

    response = client.post(
        "/api/brands",
        json={"name": "Samsung", "device_type_id": device_type_id},
        headers=auth_headers,
    )
    assert response.status_code == 200
    brand_id = response.json()["id"]
    assert [brand["id"] for brand in client.get("/api/brands", params={"device_type_id": device_type_id}, headers=auth_headers).json()] == [brand_id]

    response = client.post(
        "/api/device-models",
        json={"name": "Galaxy S25", "brand_id": brand_id},
        headers=auth_headers,
    )
    assert response.status_code == 200
    model_id = response.json()["id"]
    assert [item["id"] for item in client.get("/api/device-models", params={"brand_id": brand_id}, headers=auth_headers).json()] == [model_id]

    response = client.put(
        f"/api/device-models/{model_id}",
        json={"name": "Galaxy S25 Ultra", "brand_id": brand_id},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Galaxy S25 Ultra"
    assert client.delete(f"/api/device-models/{model_id}", headers=auth_headers).status_code == 204
    assert client.delete(f"/api/brands/{brand_id}", headers=auth_headers).status_code == 204
    assert client.delete(f"/api/device-types/{device_type_id}", headers=auth_headers).status_code == 204


def test_device_suggest_matches_brand_and_model(client, auth_headers, db):
    brand = Brand(name="Samsung")
    db.add(brand)
    db.flush()
    model = DeviceModel(name="Galaxy S25", brand_id=brand.id)
    db.add(model)
    db.commit()

    by_brand = client.get("/api/devices/suggest?q=sam", headers=auth_headers)
    by_model = client.get("/api/devices/suggest?q=galaxy", headers=auth_headers)

    assert by_brand.status_code == 200
    assert by_brand.json()[0]["name"] == "Samsung Galaxy S25"
    assert by_model.json()[0]["id"] == model.id

def test_device_types_list_and_update(client, auth_headers):
    created = client.post("/api/device-types", json={"name": "Планшет"}, headers=auth_headers)
    assert created.status_code == 200, created.text
    device_type_id = created.json()["id"]
    assert device_type_id in [item["id"] for item in client.get("/api/device-types", headers=auth_headers).json()]

    updated = client.put(
        f"/api/device-types/{device_type_id}",
        json={"name": "Планшетный компьютер"},
        headers=auth_headers,
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Планшетный компьютер"

    brand = client.post(
        "/api/brands",
        json={"name": "Lenovo", "device_type_id": device_type_id},
        headers=auth_headers,
    )
    assert brand.status_code == 200, brand.text
    renamed = client.put(
        f"/api/brands/{brand.json()['id']}",
        json={"name": "Lenovo Tab", "device_type_id": device_type_id},
        headers=auth_headers,
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Lenovo Tab"
