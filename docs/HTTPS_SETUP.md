# Настройка HTTPS (production)

Руководство по развёртыванию WEU AI с HTTPS в production-окружении.

---

## Вариант 1: Certbot + Nginx (рекомендуется)

### Требования
- VPS/сервер с публичным IP
- Домен, направленный на сервер (A-запись)
- Ubuntu 20.04+ или Debian 11+

### Шаг 1: Установи Nginx

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
```

### Шаг 2: Конфигурация Nginx

Создай файл `/etc/nginx/sites-available/weu-ai`:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket для SSH-терминала
    location /ws/ {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

```bash
# Включи сайт
sudo ln -s /etc/nginx/sites-available/weu-ai /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Шаг 3: Получи SSL-сертификат

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Certbot автоматически обновит конфиг Nginx и добавит редирект HTTP → HTTPS.

### Шаг 4: Автообновление сертификата

```bash
# Проверь, что обновление работает
sudo certbot renew --dry-run

# Cron (добавляется автоматически certbot'ом)
# 0 12 * * * certbot renew --quiet
```

### Шаг 5: Обнови .env

```env
ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com
DEBUG=0
DJANGO_PORT=9000
```

---

## Вариант 2: Caddy (проще, автоматический HTTPS)

```bash
# Установка Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

**Caddyfile** (`/etc/caddy/Caddyfile`):

```
yourdomain.com {
    reverse_proxy localhost:9000

    handle /ws/* {
        reverse_proxy localhost:9000 {
            header_up Upgrade {http.upgrade}
            header_up Connection {http.connection}
        }
    }
}
```

```bash
sudo systemctl reload caddy
```

Caddy автоматически получает и обновляет Let's Encrypt сертификаты. Ничего больше не нужно.

---

## Вариант 3: Docker + Traefik

Если используешь Docker Compose, добавь Traefik как reverse proxy:

```yaml
# docker-compose.prod.yml
services:
  traefik:
    image: traefik:v3
    command:
      - "--api.insecure=true"
      - "--providers.docker=true"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.myresolver.acme.httpchallenge=true"
      - "--certificatesresolvers.myresolver.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.myresolver.acme.email=your@email.com"
      - "--certificatesresolvers.myresolver.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./letsencrypt:/letsencrypt

  web:
    # ... твой web сервис ...
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.web.rule=Host(`yourdomain.com`)"
      - "traefik.http.routers.web.entrypoints=websecure"
      - "traefik.http.routers.web.tls.certresolver=myresolver"
      - "traefik.http.services.web.loadbalancer.server.port=9000"
```

---

## Настройки Django для HTTPS (production)

Добавь в `.env`:

```env
DEBUG=0
ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com
SECRET_KEY=your-very-long-random-secret-key
CSRF_TRUSTED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
SECURE_SSL_REDIRECT=1
SESSION_COOKIE_SECURE=1
CSRF_COOKIE_SECURE=1
```

---

## Проверка

```bash
# Проверь SSL
curl -I https://yourdomain.com/api/health/

# Должен вернуть:
# HTTP/2 200
# {"status": "ok", ...}

# Проверь WebSocket
# Открой SSH-терминал в браузере → он должен работать через wss://
```

---

## Устранение проблем

**CSRF errors (403):**
```
Добавь в .env:
CSRF_TRUSTED_ORIGINS=https://yourdomain.com
```

**WebSocket не работает через Nginx:**
```nginx
# Убедись что в location /ws/ есть:
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

**502 Bad Gateway:**
```bash
# Проверь что Daphne/Django запущен
systemctl status weu-ai
# Или в Docker:
docker compose ps
docker compose logs web
```
