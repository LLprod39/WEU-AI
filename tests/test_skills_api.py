import json

import pytest


@pytest.mark.django_db
def test_skills_api_create_list_preview(authenticated_client):
    create_payload = {
        "name": "Corp Policy",
        "slug": "corp-policy",
        "status": "prod",
        "rules": "Always use approved servers",
        "auto_apply_chat": True,
    }
    create_resp = authenticated_client.post(
        "/skills/api/skills/",
        data=json.dumps(create_payload),
        content_type="application/json",
    )
    assert create_resp.status_code == 200
    create_data = create_resp.json()
    assert create_data.get("success") is True
    skill_id = create_data.get("skill_id")
    assert isinstance(skill_id, int)

    list_resp = authenticated_client.get("/skills/api/skills/")
    assert list_resp.status_code == 200
    list_data = list_resp.json()
    assert list_data.get("success") is True
    assert any(s.get("id") == skill_id for s in list_data.get("skills", []))

    preview_resp = authenticated_client.post(
        "/skills/api/context/preview/",
        data=json.dumps({"channel": "chat", "skill_ids": [skill_id]}),
        content_type="application/json",
    )
    assert preview_resp.status_code == 200
    preview_data = preview_resp.json()
    assert preview_data.get("success") is True
    assert "approved servers" in preview_data.get("text", "")
