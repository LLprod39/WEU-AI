import json

import pytest
from django.contrib.auth.models import User

from skills.models import Skill, SkillShare
from skills.services import SkillService


@pytest.mark.django_db
def test_skills_are_isolated_by_owner_and_visible_when_shared(user):
    other = User.objects.create_user(username="other", password="x")

    own = Skill.objects.create(owner=user, name="Own", slug="own", status=Skill.STATUS_PROD, auto_apply_agents=True)
    private_other = Skill.objects.create(
        owner=other,
        name="Other private",
        slug="other-private",
        status=Skill.STATUS_PROD,
        auto_apply_agents=True,
    )
    shared_other = Skill.objects.create(
        owner=other,
        name="Other shared",
        slug="other-shared",
        status=Skill.STATUS_PROD,
        auto_apply_agents=True,
    )
    SkillShare.objects.create(skill=shared_other, shared_with=user, shared_by=other, can_edit=False, can_manage=False)

    ctx = SkillService.build_skill_context(user=user, skill_ids=None, channel="agent", runtime="cursor")

    assert own.id in ctx["skill_ids"]
    assert shared_other.id in ctx["skill_ids"]
    assert private_other.id not in ctx["skill_ids"]


@pytest.mark.django_db
def test_skill_share_api_grant_and_revoke(authenticated_client, user):
    target = User.objects.create_user(username="target", password="x")
    skill = Skill.objects.create(owner=user, name="Policy", slug="policy")

    grant_resp = authenticated_client.post(
        f"/skills/api/skills/{skill.id}/shares/",
        data=json.dumps({"username": "target", "can_edit": True, "can_manage": False}),
        content_type="application/json",
    )
    assert grant_resp.status_code == 200
    assert grant_resp.json().get("success") is True

    list_resp = authenticated_client.get(f"/skills/api/skills/{skill.id}/shares/")
    assert list_resp.status_code == 200
    shares = list_resp.json().get("shares", [])
    assert len(shares) == 1
    assert shares[0]["username"] == "target"
    assert shares[0]["can_edit"] is True

    share_id = shares[0]["id"]
    revoke_resp = authenticated_client.delete(f"/skills/api/skills/{skill.id}/shares/{share_id}/")
    assert revoke_resp.status_code == 200
    assert revoke_resp.json().get("success") is True
