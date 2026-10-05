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
