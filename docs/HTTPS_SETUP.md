# HTTPS для weuai.site — что делать по порядку

Чтобы **https://weuai.site** и **https://www.weuai.site** открывались без «Небезопасно» и «The content of the page cannot be displayed», сделай на сервере шаги ниже. Все команды — в папке проекта `~/WEU-AI`.

---

## Шаг 1. Подготовка

```bash
cd ~/WEU-AI
mkdir -p certbot/www
```

---

## Шаг 2. Запуск с Nginx (сейчас у тебя уже есть)

Если контейнеры уже подняты с nginx — ничего не делай. Если перезапускаешь — всегда с **WEU_PORT=8000**:

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml down
WEU_PORT=8000 docker compose -f docker-compose.yml -f docker-compose.https.yml up -d
```

Проверка: в браузере **http://weuai.site** или **http://www.weuai.site** — должна открываться страница логина.

---

## Шаг 3. Установка certbot (если ещё нет)

```bash
sudo apt update
sudo apt install -y certbot
```

Если была ошибка dpkg: сначала `sudo dpkg --configure -a`, потом снова `apt install`.

---

## Шаг 4. Получение бесплатного сертификата Let's Encrypt

Подставь **свой email** вместо `твой@email.com`:

```bash
cd ~/WEU-AI
sudo certbot certonly --webroot -w "$(pwd)/certbot/www" -d weuai.site -d www.weuai.site --email твой@email.com --agree-tos --no-eff-email
```

Если всё ок — в конце будет сообщение, что сертификат сохранён в `/etc/letsencrypt/live/weuai.site/`.

---

## Шаг 5. Включение HTTPS в Nginx

На сервере отредактируй файл **docker-compose.https.yml**:

```bash
nano ~/WEU-AI/docker-compose.https.yml
```

Найди строку:

```yaml
- ./docker/nginx-http-first.conf:/etc/nginx/conf.d/default.conf
```

Замени на:

```yaml
- ./docker/nginx-https.conf:/etc/nginx/conf.d/default.conf
```

Сохрани (Ctrl+O, Enter, Ctrl+X).

Перезапусти nginx:

```bash
cd ~/WEU-AI
WEU_PORT=8000 docker compose -f docker-compose.yml -f docker-compose.https.yml restart nginx
```

---

## Шаг 6. Проверка

Открой в браузере:

- **https://weuai.site**
- **https://www.weuai.site**

Должна открываться страница логина, в адресной строке — замочек (без «Небезопасно»).  
**http://weuai.site** будет автоматически перенаправляться на **https://weuai.site**.

---

## Обновление сертификата (раз в ~3 месяца)

Let's Encrypt выдаёт серт на 90 дней. Обновить:

```bash
sudo certbot renew
cd ~/WEU-AI
WEU_PORT=8000 docker compose -f docker-compose.yml -f docker-compose.https.yml restart nginx
```

Можно добавить в cron (каждый день в 3:00):

```bash
sudo crontab -e
```

Строка:

```
0 3 * * * certbot renew --quiet && cd /root/WEU-AI && WEU_PORT=8000 docker compose -f docker-compose.yml -f docker-compose.https.yml restart nginx
```

---

## Если домен другой

В файлах **docker/nginx-http-first.conf** и **docker/nginx-https.conf** замени **weuai.site** на свой домен. В команде certbot (шаг 4) укажи свой домен и email.
