import pytest
from django.contrib.auth.models import User
from django.test import override_settings

from core_ui.context_processors import is_server_only_user, user_can_feature


@pytest.mark.django_db
@override_settings(
    DOMAIN_AUTH_ENABLED=True,
    DOMAIN_AUTH_HEADER="X-Forwarded-User",
    DOMAIN_AUTH_AUTO_CREATE=True,
    DOMAIN_AUTH_DEFAULT_PROFILE="server_only",
)
def test_domain_auth_autocreates_server_only_user(client):
    response = client.get("/", HTTP_X_FORWARDED_USER=r"CORP\Alice")

    assert response.status_code == 302
    assert response.url == "/servers/"

    user = User.objects.get(username="alice")
    assert str(user.id) == client.session.get("_auth_user_id")
    assert user_can_feature(user, "servers") is True
    assert user_can_feature(user, "tasks") is False
    assert is_server_only_user(user) is True


@pytest.mark.django_db
@override_settings(
    DOMAIN_AUTH_ENABLED=True,
    DOMAIN_AUTH_HEADER="X-Forwarded-User",
    DOMAIN_AUTH_AUTO_CREATE=True,
)
def test_domain_auth_uses_existing_user_without_downgrade(client):
    existing = User.objects.create_user(
        username="john",
        password="pass123",
        is_staff=True,
    )

    response = client.get("/", HTTP_X_FORWARDED_USER=r"CORP\John")

    assert response.status_code == 200
    assert str(existing.id) == client.session.get("_auth_user_id")

    existing.refresh_from_db()
    assert existing.is_staff is True


@pytest.mark.django_db
@override_settings(
    DOMAIN_AUTH_ENABLED=True,
    DOMAIN_AUTH_HEADER="X-Forwarded-User",
    DOMAIN_AUTH_AUTO_CREATE=False,
)
def test_domain_auth_without_auto_create_redirects_to_login(client):
    response = client.get("/", HTTP_X_FORWARDED_USER=r"CORP\NewUser")

    assert response.status_code == 302
    assert response.url.startswith("/login/")
    assert not User.objects.filter(username="newuser").exists()
    assert "_auth_user_id" not in client.session


@pytest.mark.django_db
@override_settings(
    DOMAIN_AUTH_ENABLED=True,
    DOMAIN_AUTH_HEADER="REMOTE_USER",
    DOMAIN_AUTH_AUTO_CREATE=True,
)
def test_domain_auth_supports_remote_user_header(client):
    response = client.get("/", REMOTE_USER=r"CORP\Bob")

    assert response.status_code == 302
    assert response.url == "/servers/"
    assert User.objects.filter(username="bob").exists()
