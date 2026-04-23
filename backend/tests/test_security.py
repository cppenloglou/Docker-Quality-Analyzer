from app.core.security import create_token, decode_token, hash_password, verify_password


def test_password_hash_roundtrip():
    password = "very-secure-password"
    hashed = hash_password(password)
    assert hashed != password
    assert verify_password(password, hashed)


def test_access_token_roundtrip():
    token = create_token("123", "access", 5)
    payload = decode_token(token)
    assert payload["sub"] == "123"
    assert payload["type"] == "access"
