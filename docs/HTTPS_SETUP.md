# HTTPS для weuai.site (Nginx + Let's Encrypt)

Чтобы сайт открывался по **https://weuai.site** и браузер не ругался, нужен SSL-сертификат. Ниже — пошаговая настройка на сервере.

---

## 1. Подготовка на сервере

В папке проекта (рядом с `docker-compose.yml`):

```bash
cd ~/WEU-AI
mkdir -p certbot/www
```

---

## 2. Запуск с Nginx (сначала только HTTP)

Останови текущие контейнеры и подними с Nginx:

```bash
docker compose down
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
```

Проверь: **http://weuai.site** должен открываться (редирект на логин). Nginx слушает 80 и проксирует в Django.

---

## 3. Получение сертификата Let's Encrypt

На сервере установи certbot (если ещё нет):

```bash
# Debian/Ubuntu
sudo apt update && sudo apt install -y certbot
```

Получи сертификат (Nginx уже отдаёт сайт и `.well-known` из `certbot/www`):

```bash
cd ~/WEU-AI
sudo certbot certonly --webroot -w "$(pwd)/certbot/www" -d weuai.site -d www.weuai.site --email твой@email.com --agree-tos --no-eff-email
```

Сертификаты появятся в `/etc/letsencrypt/live/weuai.site/`.

---

## 4. Включение HTTPS в Nginx

В `docker-compose.https.yml` замени конфиг Nginx на вариант с SSL:

Было:
```yaml
- ./docker/nginx-http-first.conf:/etc/nginx/conf.d/default.conf
```

Сделай:
```yaml
- ./docker/nginx-https.conf:/etc/nginx/conf.d/default.conf
```

Перезапусти Nginx:

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml restart nginx
```

После этого:
- **https://weuai.site** и **https://www.weuai.site** открываются по HTTPS
- **http://weuai.site** перенаправляется на **https://weuai.site**

---

## 5. Обновление сертификата (раз в ~3 месяца)

Let's Encrypt выдаёт серты на 90 дней. Обновление:

```bash
sudo certbot renew
docker compose -f docker-compose.yml -f docker-compose.https.yml restart nginx
```

Можно повесить в cron: `0 3 * * * certbot renew --quiet && docker compose -f /root/WEU-AI/docker-compose.yml -f /root/WEU-AI/docker-compose.https.yml restart nginx`

---

## Если домен другой

В `docker/nginx-https.conf` и `docker/nginx-http-first.conf` замени **weuai.site** на свой домен. В команде certbot укажи свой домен и email.
