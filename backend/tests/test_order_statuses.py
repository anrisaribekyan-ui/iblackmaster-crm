from sqlalchemy import select

from app.models import OrderStatus, StatusGroup


def test_order_status_groups_follow_lifecycle_order(client, auth_headers):
    response = client.get("/api/order-statuses", headers=auth_headers)

    assert response.status_code == 200
    groups = response.json()
    assert [group["group"] for group in groups] == ["new", "inWork", "wait", "finish", "closed"]
    assert sum(len(group["statuses"]) for group in groups) == 14
    for group in groups:
        assert [status["sort"] for status in group["statuses"]] == sorted(
            status["sort"] for status in group["statuses"]
        )


def test_order_status_create_update_and_delete_last_group_status(client, auth_headers, db):
    created = client.post(
        "/api/order-statuses",
        json={
            "group": "wait",
            "name": "Ожидает согласования",
            "client_name": "Согласование",
            "color": "#123456",
            "sort": 50,
            "pay_required": False,
            "comment_mode": "optional",
            "role_access": {"2": {"view": True, "set": False, "change": True}},
        },
        headers=auth_headers,
    )
    assert created.status_code == 200
    status_id = created.json()["id"]
    assert created.json()["role_access"]["2"]["set"] is False

    updated = client.put(
        f"/api/order-statuses/{status_id}",
        json={
            "group": "wait",
            "name": "Согласование",
            "client_name": None,
            "color": "#654321",
            "sort": 51,
            "pay_required": True,
            "comment_mode": "required",
            "role_access": {},
        },
        headers=auth_headers,
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Согласование"
    assert updated.json()["pay_required"] is True

    wait_statuses = db.scalars(
        select(OrderStatus).where(
            OrderStatus.group == StatusGroup.WAIT,
            OrderStatus.is_active.is_(True),
        )
    ).all()
    for item in wait_statuses:
        item.is_active = item.id == status_id
    db.commit()

    rejected = client.delete(f"/api/order-statuses/{status_id}", headers=auth_headers)
    assert rejected.status_code == 400
    assert rejected.json()["message"] == "Нельзя удалить последний статус в группе"
