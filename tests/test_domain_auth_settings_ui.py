import pytest
from django.contrib.auth.models import User
from django.test import override_settings

from app.core.model_config import model_manager


@pytest.mark.django_db
def test_api_settings_returns_domain_auth_fields(client, staff_user):
    client.force_login(staff_user)
    response = client.get("/api/settings/", HTTP_X_REQUESTED_WITH="XMLHttpRequest")

    assert response.status_code == 200
    data = response.json()
    assert data.get("success") is True
    cfg = data.get("config", {})
    assert "domain_auth_enabled" in cfg
    assert "domain_auth_header" in cfg
    assert "domain_auth_auto_create" in cfg
    assert "domain_auth_lowercase_usernames" in cfg
    assert "domain_auth_default_profile" in cfg


@pytest.mark.django_db
@override_settings(
    DOMAIN_AUTH_ENABLED=False,
    DOMAIN_AUTH_HEADER="REMOTE_USER",
    DOMAIN_AUTH_AUTO_CREATE=False,
    DOMAIN_AUTH_LOWERCASE_USERNAMES=True,
    DOMAIN_AUTH_DEFAULT_PROFILE="server_only",
)
def test_domain_auth_can_be_enabled_from_settings_ui(client, staff_user, monkeypatch):
    old = {
        "domain_auth_enabled": getattr(model_manager.config, "domain_auth_enabled", None),
        "domain_auth_header": getattr(model_manager.config, "domain_auth_header", None),
        "domain_auth_auto_create": getattr(model_manager.config, "domain_auth_auto_create", None),
        "domain_auth_lowercase_usernames": getattr(model_manager.config, "domain_auth_lowercase_usernames", None),
        "domain_auth_default_profile": getattr(model_manager.config, "domain_auth_default_profile", None),
    }
    monkeypatch.setattr(model_manager, "save_config", lambda *args, **kwargs: None)

    try:
        client.force_login(staff_user)
        response = client.post(
            "/api/settings/",
            data={
                "domain_auth_enabled": True,
                "domain_auth_header": "X-Forwarded-User",
                "domain_auth_auto_create": True,
                "domain_auth_lowercase_usernames": True,
                "domain_auth_default_profile": "server_only",
            },
            content_type="application/json",
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )

        assert response.status_code == 200
        assert response.json().get("success") is True

        client.logout()
        anonymous_response = client.get("/", HTTP_X_FORWARDED_USER=r"CORP\UIUser")

        assert anonymous_response.status_code == 302
        assert anonymous_response.url == "/servers/"
        assert User.objects.filter(username="uiuser").exists()
    finally:
        model_manager.update_config(**old)
