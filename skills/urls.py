from django.urls import path

from skills import views

app_name = "skills"

urlpatterns = [
    path("", views.skills_page, name="skills_page"),
    path("api/skills/", views.api_skills_list_create, name="api_skills_list_create"),
    path("api/skills/<int:skill_id>/", views.api_skill_detail, name="api_skill_detail"),
    path("api/skills/<int:skill_id>/shares/", views.api_skill_shares, name="api_skill_shares"),
    path(
        "api/skills/<int:skill_id>/shares/<int:share_id>/",
        views.api_skill_share_delete,
        name="api_skill_share_delete",
    ),
    path("api/skills/<int:skill_id>/sync/", views.api_skill_sync, name="api_skill_sync"),
    path("api/context/preview/", views.api_skill_context_preview, name="api_skill_context_preview"),
    path("api/options/", views.api_skill_options, name="api_skill_options"),
    path("api/servers/", views.api_skill_servers, name="api_skill_servers"),
    path("api/assistant/", views.api_skill_assistant, name="api_skill_assistant"),
]
