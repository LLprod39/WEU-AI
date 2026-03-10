import json

import pytest
from django.contrib.auth.models import Group, User
from django.test import Client

from core_ui.models import UserAppPermission


def _json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


@pytest.mark.django_db
def test_health_and_anonymous_auth_endpoints():
    client = Client()

    health = client.get("/api/health/")
    assert health.status_code == 200
    assert "status" in health.json()

    session = client.get("/api/auth/session/")
    assert session.status_code == 200
    assert session.json() == {"authenticated": False, "user": None}

    ws = client.get("/api/auth/ws-token/")
    assert ws.status_code == 401
    assert ws.json()["error"] == "Not authenticated"


@pytest.mark.django_db
def test_auth_login_logout_session_and_ws_token_flow():
    user = User.objects.create_user(username="auth-user", password="secret123")
    client = Client()

    login = client.post(
        "/api/auth/login/",
        data=_json({"username": "auth-user", "password": "secret123"}),
        content_type="application/json",
    )
    assert login.status_code == 200
    assert login.json()["success"] is True
    assert login.json()["authenticated"] is True

    session = client.get("/api/auth/session/")
    assert session.status_code == 200
    assert session.json()["authenticated"] is True
    assert session.json()["user"]["id"] == user.id

    ws = client.get("/api/auth/ws-token/")
    assert ws.status_code == 200
    assert ws.json()["token"]

    logout = client.post("/api/auth/logout/")
    assert logout.status_code == 200
    assert logout.json()["authenticated"] is False

    after = client.get("/api/auth/session/")
    assert after.status_code == 200
    assert after.json()["authenticated"] is False


@pytest.mark.django_db
def test_admin_and_settings_endpoints_for_staff_user(monkeypatch):
    staff = User.objects.create_user(username="staff-core", password="x", is_staff=True)
    client = Client()
    client.force_login(staff)

    dashboard = client.get("/api/admin/dashboard/")
    assert dashboard.status_code == 200
    assert dashboard.json()["success"] is True

    users_activity = client.get("/api/admin/users/activity/")
    assert users_activity.status_code == 200
    assert users_activity.json()["success"] is True

    user_sessions = client.get("/api/admin/users/sessions/")
    assert user_sessions.status_code == 200
    assert user_sessions.json()["success"] is True

    settings_check = client.get("/api/settings/check/")
    assert settings_check.status_code == 200
    assert "configured" in settings_check.json()

    settings_payload = client.get("/api/settings/")
    assert settings_payload.status_code == 200
    assert settings_payload.json()["success"] is True

    models_payload = client.get("/api/models/")
    assert models_payload.status_code == 200
    assert "current" in models_payload.json()

    refresh = client.post(
        "/api/models/refresh/",
        data=_json({"provider": "unknown-provider"}),
        content_type="application/json",
    )
    assert refresh.status_code == 400
    assert "provider must be one of" in refresh.json()["error"]


@pytest.mark.django_db
def test_access_management_users_groups_permissions_crud_flow():
    admin = User.objects.create_user(username="settings-admin", password="x", is_staff=True)
    client = Client()
    client.force_login(admin)

    users_list = client.get("/api/access/users/")
    assert users_list.status_code == 200
    assert "users" in users_list.json()

    create_user = client.post(
        "/api/access/users/",
        data=_json(
            {
                "username": "managed-user",
                "email": "managed@example.com",
                "password": "pass-1234",
                "is_staff": False,
            }
        ),
        content_type="application/json",
    )
    assert create_user.status_code == 200
    managed_user_id = create_user.json()["user"]["id"]

    detail = client.get(f"/api/access/users/{managed_user_id}/")
    assert detail.status_code == 200
    assert detail.json()["user"]["username"] == "managed-user"

    update = client.put(
        f"/api/access/users/{managed_user_id}/",
        data=_json({"email": "managed+1@example.com", "is_active": True}),
        content_type="application/json",
    )
    assert update.status_code == 200
    assert update.json()["success"] is True

    password = client.post(
        f"/api/access/users/{managed_user_id}/password/",
        data=_json({"password": "pass-5678"}),
        content_type="application/json",
    )
    assert password.status_code == 200
    assert password.json()["success"] is True

    profile = client.post(
        f"/api/access/users/{managed_user_id}/profile/",
        data=_json({"profile": "server_only"}),
        content_type="application/json",
    )
    assert profile.status_code == 200
    assert profile.json()["success"] is True

    groups_list = client.get("/api/access/groups/")
    assert groups_list.status_code == 200
    assert "groups" in groups_list.json()

    create_group = client.post(
        "/api/access/groups/",
        data=_json({"name": "ops-team", "members": [managed_user_id]}),
        content_type="application/json",
    )
    assert create_group.status_code == 200
    group_id = create_group.json()["group"]["id"]
    assert Group.objects.filter(id=group_id, name="ops-team").exists()

    group_detail = client.get(f"/api/access/groups/{group_id}/")
    assert group_detail.status_code == 200
    assert group_detail.json()["group"]["name"] == "ops-team"

    group_update = client.put(
        f"/api/access/groups/{group_id}/",
        data=_json({"name": "ops-team-updated", "members": [managed_user_id]}),
        content_type="application/json",
    )
    assert group_update.status_code == 200
    assert group_update.json()["success"] is True

    add_member = client.post(
        f"/api/access/groups/{group_id}/members/",
        data=_json({"user_id": admin.id}),
        content_type="application/json",
    )
    assert add_member.status_code == 200
    assert add_member.json()["success"] is True

    remove_member = client.delete(
        f"/api/access/groups/{group_id}/members/",
        data=_json({"user_id": admin.id}),
        content_type="application/json",
    )
    assert remove_member.status_code == 200
    assert remove_member.json()["success"] is True

    permissions_list = client.get("/api/access/permissions/")
    assert permissions_list.status_code == 200
    assert "features" in permissions_list.json()

    create_permission = client.post(
        "/api/access/permissions/",
        data=_json({"user_id": managed_user_id, "feature": "settings", "allowed": True}),
        content_type="application/json",
    )
    assert create_permission.status_code == 200
    perm_id = create_permission.json()["permission"]["id"]
    assert UserAppPermission.objects.filter(id=perm_id, user_id=managed_user_id, feature="settings").exists()

    update_permission = client.put(
        f"/api/access/permissions/{perm_id}/",
        data=_json({"allowed": False}),
        content_type="application/json",
    )
    assert update_permission.status_code == 200
    assert update_permission.json()["permission"]["allowed"] is False

    delete_permission = client.delete(f"/api/access/permissions/{perm_id}/")
    assert delete_permission.status_code == 200
    assert delete_permission.json()["success"] is True

    delete_group = client.delete(f"/api/access/groups/{group_id}/")
    assert delete_group.status_code == 200
    assert delete_group.json()["success"] is True

    delete_user = client.delete(f"/api/access/users/{managed_user_id}/")
    assert delete_user.status_code == 200
    assert delete_user.json()["success"] is True
