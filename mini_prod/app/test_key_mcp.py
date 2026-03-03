import pytest

import key_mcp


@pytest.fixture(autouse=True)
def clear_keycloak_runtime_defaults():
    with key_mcp._RUNTIME_DEFAULT_LOCK:
        key_mcp._RUNTIME_DEFAULT.clear()
    yield
    with key_mcp._RUNTIME_DEFAULT_LOCK:
        key_mcp._RUNTIME_DEFAULT.clear()


def test_normalize_base_url_preserves_scheme_port_and_path(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(key_mcp, "ALLOW_INSECURE_HTTP", True)
    assert key_mcp._normalize_base_url("http://keycloak.local:8080/auth/") == "http://keycloak.local:8080/auth"


def test_resolve_config_reads_profile_secrets_from_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        key_mcp,
        "_load_profiles",
        lambda: {
            "default_profile": "prod",
            "profiles": {
                "prod": {
                    "base_url": "https://sso.example.com/auth",
                    "realm": "main",
                    "token_realm": "master",
                    "client_id": "kc-admin",
                    "admin_user": "svc-keycloak",
                    "admin_password_env": "KC_PASS",
                    "client_secret_env": "KC_SECRET",
                }
            },
        },
    )
    monkeypatch.setenv("KC_PASS", "top-secret")
    monkeypatch.setenv("KC_SECRET", "client-secret")

    config = key_mcp._resolve_config({})

    assert config.base_url == "https://sso.example.com/auth"
    assert config.realm == "main"
    assert config.token_realm == "master"
    assert config.client_id == "kc-admin"
    assert config.admin_user == "svc-keycloak"
    assert config.admin_password == "top-secret"
    assert config.client_secret == "client-secret"
    assert config.profile_name == "prod"


def test_resolve_user_rejects_fuzzy_match_by_default():
    class DummyClient(key_mcp.KeycloakAdminClient):
        def __init__(self):
            pass

        def search_users(self, query, *, exact=False, max_results=key_mcp.MAX_SEARCH_RESULTS):
            return []

        def search_users_by_email(self, email):
            return []

        def search_user_candidates(self, login, *, max_candidates=5):
            return [
                {
                    "user": {"id": "12345678-1234-1234-1234-123456789012", "username": "alice.smith"},
                    "score": 120,
                    "reasons": ["username_contains_query"],
                }
            ]

    with pytest.raises(key_mcp.ToolError, match="Exact user match not found"):
        DummyClient().resolve_user(login="alice")


def test_build_response_returns_is_error_for_tool_error():
    payload = key_mcp._build_response(
        {
            "jsonrpc": "2.0",
            "id": "1",
            "method": "tools/call",
            "params": {"name": "keycloak_search_users", "arguments": {}},
        }
    )

    assert payload is not None
    assert payload["result"]["isError"] is True
    assert payload["result"]["structuredContent"]["error"] == "query is required"


def test_use_profile_schema_does_not_hardcode_profile_enum():
    tool = next(item for item in key_mcp.TOOLS if item["name"] == "keycloak_use_profile")

    assert "enum" not in tool["inputSchema"]["properties"]["profile"]
