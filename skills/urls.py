from django.urls import path

from skills import views

app_name = "skills"

urlpatterns = [
    path("", views.skills_page, name="skills_page"),
    path("legacy/", views.skills_page_legacy, name="skills_page_legacy"),
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
    path("api/skills/catalog/", views.api_skill_catalog_list, name="api_skill_catalog_list"),
    path("api/skills/catalog/install/", views.api_skill_catalog_install, name="api_skill_catalog_install"),
    path("api/skills/catalog/install-all/", views.api_skill_catalog_install_all, name="api_skill_catalog_install_all"),
    path("api/mcp/pool/", views.api_mcp_pool_list_create, name="api_mcp_pool_list_create"),
    path("api/mcp/pool/<int:server_id>/", views.api_mcp_pool_detail, name="api_mcp_pool_detail"),
    path("api/mcp/pool/<int:server_id>/add-to-agent/", views.api_mcp_pool_add_to_agent, name="api_mcp_pool_add_to_agent"),
    path("api/mcp/pool/<int:server_id>/test/", views.api_mcp_pool_test, name="api_mcp_pool_test"),
    path("api/mcp/catalog/", views.api_mcp_catalog_list, name="api_mcp_catalog_list"),
    path("api/mcp/catalog/install/", views.api_mcp_catalog_install, name="api_mcp_catalog_install"),
    path("api/mcp/catalog/install-all/", views.api_mcp_catalog_install_all, name="api_mcp_catalog_install_all"),
    path("api/mcp/catalog/fetch/", views.api_mcp_catalog_fetch, name="api_mcp_catalog_fetch"),
    path("api/mcp/catalog/fetch-registry/", views.api_mcp_catalog_fetch_registry, name="api_mcp_catalog_fetch_registry"),
    path("api/mcp/sources/", views.api_mcp_sources_list, name="api_mcp_sources_list"),
    path("api/mcp/registry/", views.api_mcp_registry_search, name="api_mcp_registry_search"),
    path("api/mcp/generator/", views.api_mcp_generator, name="api_mcp_generator"),
    path("api/skills/<int:skill_id>/bind-agent/", views.api_skill_bind_agent, name="api_skill_bind_agent"),
]
