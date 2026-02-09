import pytest

from skills.models import Skill
from skills.services import SkillService


@pytest.mark.django_db
def test_build_skill_context_auto_apply_chat(user):
    Skill.objects.create(
        owner=user,
        name="Chat Policy",
        slug="chat-policy",
        status=Skill.STATUS_PROD,
        rules="No secrets",
        auto_apply_chat=True,
    )
    Skill.objects.create(
        owner=user,
        name="Workflow Only",
        slug="wf-only",
        status=Skill.STATUS_PROD,
        rules="WF",
        auto_apply_workflows=True,
    )

    result = SkillService.build_skill_context(user=user, skill_ids=None, channel="chat", runtime="cursor")

    assert result["skill_names"] == ["Chat Policy"]
    assert "No secrets" in result["text"]
    assert "WF" not in result["text"]


@pytest.mark.django_db
def test_build_skill_context_explicit_ids_override_channel(user):
    a = Skill.objects.create(
        owner=user,
        name="A",
        slug="a",
        status=Skill.STATUS_DRAFT,
        rules="alpha",
        auto_apply_chat=False,
    )
    b = Skill.objects.create(
        owner=user,
        name="B",
        slug="b",
        status=Skill.STATUS_PROD,
        rules="beta",
        auto_apply_chat=False,
    )

    result = SkillService.build_skill_context(user=user, skill_ids=[a.id, b.id], channel="chat", runtime="cursor")

    assert set(result["skill_ids"]) == {a.id, b.id}
    assert "alpha" in result["text"]
    assert "beta" in result["text"]
