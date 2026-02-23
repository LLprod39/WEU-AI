from app.core.model_config import ModelConfig, model_manager
from app.core.provider_registry import ProviderRegistry


def test_model_config_has_openai_toggle_disabled_by_default():
    cfg = ModelConfig()
    assert cfg.openai_enabled is False


def test_model_manager_returns_openai_models_when_provider_selected():
    old_cfg = model_manager.config
    try:
        model_manager.config = ModelConfig(
            openai_enabled=True,
            chat_model_openai="gpt-5-mini",
            agent_model_openai="gpt-5",
        )
        assert model_manager.get_chat_model("openai") == "gpt-5-mini"
        assert model_manager.get_agent_model("openai") == "gpt-5"
        assert model_manager.is_provider_enabled("openai") is True
    finally:
        model_manager.config = old_cfg


def test_provider_registry_openai_accepts_codex_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("CODEX_API_KEY", "test_codex_key")

    old_cfg = model_manager.config
    try:
        model_manager.config = ModelConfig(openai_enabled=True)
        registry = ProviderRegistry()
        assert registry.is_enabled("openai") is True
        assert registry.is_configured("openai") is True

        status = registry.get_provider_status("openai")
        assert status["api_key_set"] is True
        assert status["api_key_name"] == "OPENAI_API_KEY/CODEX_API_KEY"
    finally:
        model_manager.config = old_cfg
