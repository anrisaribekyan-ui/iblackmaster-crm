import pytest

from app.utils.phone import format_phone, normalize_phone


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("8 (916) 186-61-19", "79161866119"),
        ("+7 916 1866119", "79161866119"),
        ("9161866119", "79161866119"),
        ("123", None),
    ],
)
def test_normalize_phone(raw, expected):
    assert normalize_phone(raw) == expected


def test_format_phone():
    assert format_phone("79161866119") == "+7 (916) 186-61-19"
    assert format_phone("123") == "123"