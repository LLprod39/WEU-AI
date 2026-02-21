# WEU AI — лендинг и документация (статический сайт)

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
