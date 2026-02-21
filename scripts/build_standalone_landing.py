#!/usr/bin/env python3
"""
Сборка статического сайта welcome + docs/ui-guide в папку standalone_landing/.
Запуск: python scripts/build_standalone_landing.py
Размещение: скопировать папку standalone_landing на любой веб-сервер (nginx, Apache, GitHub Pages).
"""
import re
import shutil
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
CORE_UI_TEMPLATES = BASE / "core_ui" / "templates"
OUT = BASE / "standalone_landing"
VIDEOS_SRC = BASE / "core_ui" / "static" / "landing" / "videos"
VIDEOS_DST = OUT / "videos"


def replace_welcome(content: str) -> str:
    content = re.sub(r"{% load static %}\s*\n", "", content)
    content = content.replace("{% url 'welcome' %}", "index.html")
    content = content.replace("{% url 'docs_ui_guide' %}", "docs/ui-guide/")
    content = content.replace("{% url 'landing_video' 'agent.mp4' %}", "videos/agent.mp4")
    content = content.replace("{% url 'landing_video' 'agent.mkv' %}", "videos/agent.mkv")
    content = content.replace("{% url 'landing_video' 'mcp.mp4' %}", "videos/mcp.mp4")
    content = content.replace("{% url 'landing_video' 'mcp.mkv' %}", "videos/mcp.mkv")
    content = content.replace("{% url 'landing_video' 'server.mp4' %}", "videos/server.mp4")
    content = content.replace("{% url 'landing_video' 'server.mkv' %}", "videos/server.mkv")
    content = content.replace("{% url 'landing_video' 'task.mp4' %}", "videos/task.mp4")
    content = content.replace("{% url 'landing_video' 'task.mkv' %}", "videos/task.mkv")
    return content


def replace_docs(content: str) -> str:
    content = re.sub(r"{% load static %}\s*\n", "", content)
    # Из docs/ui-guide/index.html ссылка на главную — на два уровня вверх
    content = content.replace("{% url 'welcome' %}", "../../index.html")
    content = content.replace("{% url 'docs_ui_guide' %}", "index.html")
    content = content.replace("{% url 'login' %}", "#")
    return content


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "docs" / "ui-guide").mkdir(parents=True, exist_ok=True)

    # index.html (welcome)
    welcome_path = CORE_UI_TEMPLATES / "welcome.html"
    index_content = replace_welcome(welcome_path.read_text(encoding="utf-8"))
    (OUT / "index.html").write_text(index_content, encoding="utf-8")
    print("Written standalone_landing/index.html")

    # docs/ui-guide/index.html
    docs_path = CORE_UI_TEMPLATES / "docs_ui_guide.html"
    docs_content = replace_docs(docs_path.read_text(encoding="utf-8"))
    (OUT / "docs" / "ui-guide" / "index.html").write_text(docs_content, encoding="utf-8")
    print("Written standalone_landing/docs/ui-guide/index.html")

    # Видео: копируем из core_ui/static/landing/videos (имена могут быть MCP.mkv — приводим к нижнему регистру для путей)
    VIDEOS_DST.mkdir(parents=True, exist_ok=True)
    for f in VIDEOS_SRC.iterdir():
        if f.is_file() and f.suffix.lower() in (".mp4", ".mkv"):
            dest_name = f.name.lower()
            shutil.copy2(f, VIDEOS_DST / dest_name)
            print(f"Copied video: videos/{dest_name}")
    if not any(VIDEOS_DST.iterdir()):
        print("Note: no video files found in core_ui/static/landing/videos/ — демо-блок будет показывать заглушку.")

    # README для размещения
    readme = """# WEU AI — лендинг и документация (статический сайт)

Содержимое:
- **index.html** — главная (welcome)
- **docs/ui-guide/index.html** — документация по интерфейсу

## Размещение на сервере

1. Скопируйте всю папку `standalone_landing` на сервер.
2. Укажите корень сайта на эту папку в nginx/Apache или откройте index.html локально.

Пример nginx:
```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/standalone_landing;
    index index.html;
    location / {
        try_files $uri $uri/ $uri/index.html =404;
    }
}
```

URL после размещения:
- Главная: /
- Документация: /docs/ui-guide/

Видео (опционально): положите файлы agent.mkv, mcp.mkv, server.mkv, task.mkv в папку videos/.
"""
    (OUT / "README.md").write_text(readme, encoding="utf-8")
    print("Written standalone_landing/README.md")
    print("Done. Deploy the folder standalone_landing/ to your web server.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
