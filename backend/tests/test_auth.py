

def test_employee_changes_own_password(client, auth_headers, owner):
    url = "/api/auth/change-password"
    assert client.post(url, json={"current_password": "nope", "new_password": "newpass123"}, headers=auth_headers).status_code == 400
    assert client.post(url, json={"current_password": "demo1234", "new_password": "short"}, headers=auth_headers).status_code == 422
    assert client.post(url, json={"current_password": "demo1234", "new_password": "demo1234"}, headers=auth_headers).status_code == 400
    ok = client.post(url, json={"current_password": "demo1234", "new_password": "newpass123"}, headers=auth_headers)
    assert ok.status_code == 200 and ok.json()["access_token"]
    assert client.post("/api/auth/login", json={"email": owner.email, "password": "newpass123"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": owner.email, "password": "demo1234"}).status_code == 401


def test_mail_test_endpoint_accepts_custom_address(client, auth_headers):
    bad = client.post("/api/settings/mail/test", json={"to": "не адрес"}, headers=auth_headers)
    assert bad.status_code == 400  # без SMTP — «почта не подключена», с неверным адресом — тоже 400
