"""
Генератор MCP-серверов с помощью AI.

Создаёт готовый Python-код MCP-сервера по описанию пользователя.
Использует OpenAI Responses API (основной) или Gemini (fallback).
"""

import json
import os

import httpx
from django.conf import settings
from loguru import logger

DEFAULT_MODEL = "gpt-5.2"
DEFAULT_BASE_URL = "https://api.openai.com/v1"


class MCPGeneratorError(Exception):
    pass


# Системный промпт — учит AI писать MCP-серверы по паттерну FastMCP
MCP_GENERATOR_SYSTEM_PROMPT = (
    "You are an expert Python developer specializing in MCP (Model Context Protocol) servers.\n"
    "Generate a complete, production-ready MCP server based on the user's description.\n\n"
    "## FastMCP Template\n"
    "```python\n"
    "from mcp.server.fastmcp import FastMCP\n"
    "mcp = FastMCP(\"server-name\")\n\n"
    "@mcp.tool()\n"
    "def my_tool(param: str) -> str:\n"
    "    \"\"\"Short description of what the tool does.\"\"\"\n"
    "    return result\n\n"
    "if __name__ == \"__main__\":\n"
    "    mcp.run()\n"
    "```\n\n"
    "## Rules\n"
    "- Every tool uses `@mcp.tool()`, has a docstring, type hints on all params, returns str/dict.\n"
    "- Use `Optional[...]` with defaults for optional params.\n\n"
    "## Patterns\n"
    "- HTTP APIs: use `httpx` with `timeout=30`, `resp.raise_for_status()`, return `json.dumps()`.\n"
    "- Databases: `sqlite3.connect()` or `psycopg2.connect()`, wrap in try/finally.\n"
    "- Files: `pathlib.Path`, check `.is_file()` before reading.\n\n"
    "## Requirements\n"
    "- NEVER hardcode secrets — use `os.environ` / `os.environ.get(...)`.\n"
    "- Wrap external calls in try/except, return error strings (don't raise through MCP).\n"
    "- Keep code in one file, add `if __name__ == \"__main__\": mcp.run()` at bottom.\n"
    "- Server name in kebab-case. Target Python 3.11+.\n\n"
    "Respond ONLY with valid JSON matching the required schema. No markdown, no extra text."
)

# JSON-схема ответа
MCP_GENERATOR_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "name": {"type": "string"},
        "description": {"type": "string"},
        "code": {"type": "string"},
        "requirements": {"type": "array", "items": {"type": "string"}},
        "env_vars": {"type": "object", "additionalProperties": {"type": "string"}},
        "command": {"type": "string"},
        "args": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["name", "description", "code", "requirements", "env_vars", "command", "args"],
}



def _extract_output_text(payload: dict) -> str:
    """Извлечь текст из ответа OpenAI Responses API."""
    if isinstance(payload.get("output_text"), str) and payload["output_text"].strip():
        return payload["output_text"].strip()
    output = payload.get("output") or []
    chunks: list[str] = []
    for item in output:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if isinstance(content, dict) and content.get("type") == "output_text":
                text = content.get("text")
                if isinstance(text, str) and text:
                    chunks.append(text)
    return "".join(chunks).strip()

def _build_messages(
    user_message: str,
    conversation_history: list[dict] | None,
    documentation: str,
) -> str:
    """Собрать пользовательский ввод для Responses API (поле `input`)."""
    parts: list[str] = []
    # История диалога — последние 10 сообщений
    if conversation_history:
        for msg in conversation_history[-10:]:
            role = msg.get("role", "user")
            text = str(msg.get("content", "")).strip()
            if text:
                parts.append(f"[{role}]: {text}")
    parts.append(user_message.strip())
    if documentation and documentation.strip():
        parts.append(f"\n--- Reference documentation ---\n{documentation.strip()}")
    return "\n\n".join(parts)

def _sanitize_result(raw: dict) -> dict:
    """Нормализовать и валидировать результат генерации."""
    def _str(val, default="") -> str:
        return str(val or default).strip()

    def _list(val) -> list[str]:
        if not isinstance(val, list):
            return []
        return [str(x).strip() for x in val if str(x).strip()]

    env_vars = raw.get("env_vars") or {}
    if not isinstance(env_vars, dict):
        env_vars = {}

    return {
        "name": _str(raw.get("name"), "mcp-server"),
        "description": _str(raw.get("description")),
        "code": _str(raw.get("code")),
        "requirements": _list(raw.get("requirements")),
        "env_vars": {str(k).strip(): str(v).strip() for k, v in env_vars.items() if k},
        "command": _str(raw.get("command"), "python"),
        "args": _list(raw.get("args")),
    }


def _generate_via_gemini(user_input: str) -> dict:
    """Запасной путь — Gemini, если нет OpenAI ключа."""
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise MCPGeneratorError("Neither OPENAI_API_KEY nor GEMINI_API_KEY is configured")
    try:
        from google import genai  # type: ignore
    except ImportError:
        raise MCPGeneratorError("google-genai package not installed for Gemini fallback")

    from app.core.model_config import model_manager

    model_name = model_manager.get_chat_model("gemini")
    client = genai.Client(api_key=api_key)
    prompt = MCP_GENERATOR_SYSTEM_PROMPT + "\n\n--- User request ---\n" + user_input

    try:
        response = client.models.generate_content(model=model_name, contents=prompt)
    except Exception as exc:
        logger.warning(f"Gemini MCP generator error: {exc}")
        raise MCPGeneratorError(f"Gemini API error: {exc}") from exc

    text = (response.text or "").strip()
    # Gemini иногда оборачивает ответ в ```json ... ```
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
    if text.endswith("```"):
        text = text.rsplit("```", 1)[0]
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        logger.warning(f"Gemini returned invalid JSON: {text[:300]}")
        raise MCPGeneratorError("Gemini returned invalid JSON")


def generate_mcp_server(
    user_message: str,
    conversation_history: list[dict] | None = None,
    documentation: str = "",
) -> dict:
    """
    Сгенерировать MCP-сервер по описанию пользователя.

    Returns:
        dict с ключами: name, description, code, requirements, env_vars, command, args, model.
    Raises:
        MCPGeneratorError при ошибках API или парсинга.
    """
    api_key = (getattr(settings, "OPENAI_API_KEY", "") or os.getenv("OPENAI_API_KEY", "")).strip()
    user_input = _build_messages(user_message, conversation_history, documentation)

    # Fallback на Gemini если нет OpenAI ключа
    if not api_key:
        logger.info("OpenAI key not set, falling back to Gemini for MCP generation")
        raw = _generate_via_gemini(user_input)
        result = _sanitize_result(raw)
        result["model"] = "gemini (fallback)"
        return result

    # --- OpenAI Responses API ---
    model = (
        getattr(settings, "SKILLS_ASSISTANT_MODEL", "") or os.getenv("SKILLS_ASSISTANT_MODEL", "")
    ).strip() or DEFAULT_MODEL
    base_url = (
        getattr(settings, "OPENAI_API_BASE", "")
        or os.getenv("OPENAI_API_BASE", "")
        or DEFAULT_BASE_URL
    ).strip().rstrip("/")

    payload = {
        "model": model,
        "instructions": MCP_GENERATOR_SYSTEM_PROMPT,
        "input": user_input,
        "temperature": 0.15,
        "max_output_tokens": 4000,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "mcp_generator",
                "schema": MCP_GENERATOR_SCHEMA,
                "strict": True,
            }
        },
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    url = f"{base_url}/responses"

    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(url, headers=headers, json=payload)
    except Exception as exc:
        logger.warning(f"OpenAI MCP generator request failed: {exc}")
        raise MCPGeneratorError("Failed to reach OpenAI API") from exc

    if response.status_code >= 400:
        logger.warning(f"OpenAI MCP generator error {response.status_code}: {response.text[:500]}")
        raise MCPGeneratorError(f"OpenAI API error {response.status_code}")

    try:
        raw_response = response.json()
    except Exception as exc:
        logger.warning(f"OpenAI MCP generator invalid JSON response: {exc}")
        raise MCPGeneratorError("Invalid response from OpenAI API") from exc

    text = _extract_output_text(raw_response)
    if not text:
        logger.warning("OpenAI MCP generator returned empty output_text")
        raise MCPGeneratorError("Empty response from OpenAI API")

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        logger.warning(f"OpenAI MCP generator non-JSON output: {text[:300]}")
        raise MCPGeneratorError("Malformed JSON from OpenAI API")

    result = _sanitize_result(parsed)
    result["model"] = model
    return result
