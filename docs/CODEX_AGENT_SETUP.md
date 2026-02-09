# Codex Agent — настройка и использование

[Codex](https://github.com/openai/codex) — легковесный coding agent от OpenAI. Интегрирован в WEU AI Platform как CLI-агент для workflow и Custom Agents.

## Способы использования Codex

### 1. Codex Cloud (веб-интерфейс)

- **Ссылка:** [chatgpt.com/codex](https://chatgpt.com/codex)
- Вход через аккаунт ChatGPT (Plus, Pro, Team, Edu, Enterprise)
- Полноценный веб-интерфейс, задачи в облаке, GitHub интеграция

### 2. Codex CLI в платформе (headless)

Codex доступен как runtime в Agent Hub и Workflows. Требует:

- **CODEX_API_KEY** или **OPENAI_API_KEY** в `.env` (для headless в Docker)
- Подписка ChatGPT или API credits OpenAI

## Установка в Docker

Codex автоматически устанавливается при сборке образов, если `INSTALL_CODEX=true` (по умолчанию включено).

```bash
# В .env
CODEX_API_KEY=sk-...   # или OPENAI_API_KEY
INSTALL_CODEX=true      # по умолчанию

# Сборка и запуск
docker compose up --build
```

Бинарник Codex загружается с [GitHub Releases](https://github.com/openai/codex/releases) (Linux x86_64 musl).

## Локальная установка (без Docker)

```bash
# npm
npm install -g @openai/codex

# или Homebrew
brew install codex

# Первый вход (для интерактивного режима)
codex login
```

Для headless: `CODEX_API_KEY` или `OPENAI_API_KEY` в окружении.

## Runtime в платформе

- **RUNTIME_CHOICES:** `codex`
- **Workflow:** выберите `codex` в поле Runtime
- **Custom Agent:** выберите «Codex CLI» в настройках агента

Команда: `codex exec --full-auto --cd {workspace} --skip-git-repo-check [-]`

Промпт передаётся через stdin (аргумент `-`), чтобы избежать ошибки «unexpected argument» при пробелах и спецсимволах.

**Ручной запуск из терминала:**
```bash
# Промпт в кавычках (один аргумент)
codex exec --full-auto --cd /path/to/workspace --skip-git-repo-check "Создайть игру змейка"

# Или через stdin
echo "Создайть игру змейка" | codex exec --full-auto --cd /path --skip-git-repo-check -
```

## Документация

- [Codex Quickstart](https://developers.openai.com/codex/quickstart)
- [Codex Non-interactive](https://developers.openai.com/codex/noninteractive)
- [GitHub: openai/codex](https://github.com/openai/codex)
