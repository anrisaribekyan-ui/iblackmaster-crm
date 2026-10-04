from sqlalchemy import select

from app.models import FormField, OrderType


def test_creating_order_type_copies_first_form(client, auth_headers, db):
    first_type = db.scalars(select(OrderType).order_by(OrderType.sort, OrderType.id)).first()
    first_fields = client.get(f"/api/order-types/{first_type.id}/fields", headers=auth_headers).json()

    response = client.post(
        "/api/order-types",
        json={"name": "Новый тип", "sort": 100},
        headers=auth_headers,
    )
    assert response.status_code == 200
    copied_fields = client.get(f"/api/order-types/{response.json()['id']}/fields", headers=auth_headers).json()

    assert len(copied_fields) == len(first_fields)
    assert [field["key"] for field in copied_fields] == [field["key"] for field in first_fields]
    assert all(field["id"] != source["id"] for field, source in zip(copied_fields, first_fields))


def test_form_fields_save_custom_and_hide_omitted(client, auth_headers, db):
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort, OrderType.id)).first()
    fields = client.get(f"/api/order-types/{order_type.id}/fields", headers=auth_headers).json()
    omitted = next(field for field in fields if field["key"] == "howKnow")
    payload = [field for field in fields if field["id"] != omitted["id"]]
    payload.append(
        {
            "key": "free_note",
            "label": "Примечание",
            "group": "device",
            "data_type": "string",
            "place": "9.0.1",
            "is_required": False,
            "is_only_dictionary": False,
            "default_value": None,
            "items": None,
            "is_visible": True,
        }
    )

    response = client.put(f"/api/order-types/{order_type.id}/fields", json=payload, headers=auth_headers)

    assert response.status_code == 200
    saved = response.json()
    assert next(field for field in saved if field["id"] == omitted["id"])["is_visible"] is False
    custom = next(field for field in saved if field["label"] == "Примечание")
    assert custom["key"].startswith("custom_")
    assert custom["group"] == "custom"


def test_name_field_cannot_be_made_optional(client, auth_headers):
    order_type = client.get("/api/order-types", headers=auth_headers).json()[0]
    fields = client.get(f"/api/order-types/{order_type['id']}/fields", headers=auth_headers).json()
    name_field = next(field for field in fields if field["key"] == "name")
    name_field["is_required"] = False

    response = client.put(f"/api/order-types/{order_type['id']}/fields", json=fields, headers=auth_headers)

    assert response.status_code == 400
    assert response.json()["message"] == "Поле имени клиента должно оставаться обязательным"