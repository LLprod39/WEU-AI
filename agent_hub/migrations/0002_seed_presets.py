from django.db import migrations


def seed_presets(apps, schema_editor):
    AgentPreset = apps.get_model("agent_hub", "AgentPreset")
    presets = [
        {
            "name": "Quick ReAct",
            "description": "Balanced internal agent with RAG for general tasks.",
            "agent_type": "react",
            "runtime": "internal",
            "config": {"model": "gemini", "use_rag": True},
        },
        {
            "name": "Ralph Iterative",
            "description": "Iterative self-improving loop with completion promise.",
            "agent_type": "ralph",
            "runtime": "internal",
            "config": {"model": "gemini", "use_rag": True, "max_iterations": 10, "completion_promise": "DONE"},
        },
        {
            "name": "Cursor CLI Runner",
            "description": "Run through Cursor CLI for local tooling.",
            "agent_type": "react",
            "runtime": "cursor",
            "config": {"max_iterations": 5, "completion_promise": "DONE"},
        },
    ]
    for preset in presets:
        AgentPreset.objects.update_or_create(name=preset["name"], defaults=preset)


class Migration(migrations.Migration):

    dependencies = [
        ("agent_hub", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_presets),
    ]
