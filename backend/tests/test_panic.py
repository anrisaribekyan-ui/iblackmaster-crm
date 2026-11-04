import httpx

from app.services import panic
from tests.conftest import *  # noqa: F401,F403

LOG = """Panic string: panic(cpu 4 caller 0xfffffff): "thermalmonitord: Missing sensor(s): TG0B, TP1a"
product: iPhone10,6
os_version: iPhone OS 16.7 (20H330)
"""


def test_rules_find_battery_sensor():
    result = panic.analyze_rules(LOG)
    titles = [f["title"] for f in result["findings"]]
    assert any("аккумулятора" in t for t in titles)
    assert result["device"] == "iPhone10,6"
    assert "TG0B" in result["sensors"]


def test_ai_used_when_key(monkeypatch):
    monkeypatch.setattr(panic.settings, "llm_api_key", "k")
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json={"choices": [{"message": {"content": "Проверьте АКБ"}}]}))
    result = panic.check(LOG, transport)
    assert result["ai"] == "Проверьте АКБ" and result["ai_enabled"]


def test_ai_failure_falls_back_to_rules(monkeypatch):
    monkeypatch.setattr(panic.settings, "llm_api_key", "k")
    transport = httpx.MockTransport(lambda r: httpx.Response(500))
    result = panic.check(LOG, transport)
    assert result["ai"] is None and result["findings"]


def test_text_from_ips_json():
    data = b'{"bug_type":"210","os_version":"iPhone OS 17.1"}\n{"panicString":"Missing sensor(s): TG0B"}'
    assert "bug_type: 210" in panic.text_from_file("x.ips", data)
