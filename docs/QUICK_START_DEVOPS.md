# Быстрый старт — DevOps/IT Edition

**WEU AI v2.0** — веб-платформа для автоматизации DevOps-задач. Этот гайд поможет запустить платформу за 10 минут.

---

## Требования

| Компонент | Минимум | Рекомендуется |
|-----------|---------|---------------|
| Python | 3.10+ | 3.12 |
| RAM | 1 GB | 4 GB |
| Docker | — | 24+ (для production) |
| Браузер | Chrome/Firefox | Chrome/Edge latest |
| API ключ | Gemini **или** Grok | Оба |

---

## Вариант 1: Docker (рекомендуется для production)

```bash
# 1. Клонируй репозиторий
git clone https://github.com/your-org/web_rA.git
cd web_rA

# 2. Создай .env
cp .env.example .env
# Открой .env и заполни минимальные поля (см. ниже)

# 3. Собери и запусти
docker compose up --build -d

# 4. Создай администратора
docker exec -it weu-web python manage.py createsuperuser

# 5. Открой в браузере
# → http://localhost:9000/welcome/
```

**Минимальный `.env` для Docker:**

```env
GEMINI_API_KEY=AIza...
SECRET_KEY=your-secret-key-here-make-it-long
MASTER_PASSWORD=your-master-password
POSTGRES_DB=weu_ai
POSTGRES_USER=weu
POSTGRES_PASSWORD=strong-password
```

---

## Вариант 2: Локально (dev, быстро)

```bash
# 1. Виртуальное окружение
python -m venv venv
source venv/bin/activate          # Linux/Mac
# venv\Scripts\activate           # Windows

# 2. Зависимости (mini = без PyTorch)
pip install -r requirements.txt

# 3. Минимальный .env
echo "GEMINI_API_KEY=AIza..." > .env
echo "SECRET_KEY=any-long-random-string" >> .env
echo "MASTER_PASSWORD=your-master-pass" >> .env

# 4. Миграции и запуск
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver

# → http://127.0.0.1:9000/welcome/
```

---

## Вариант 3: Локально + PostgreSQL в Docker

```bash
# 1. Подними только Postgres
docker compose up postgres -d

# 2. venv + pip
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# 3. Добавь в .env переменные Postgres
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=weu_ai
POSTGRES_USER=weu
POSTGRES_PASSWORD=weu_pass

# 4. Автоматические миграции + создание админа
python scripts/setup_postgres_and_migrate.py

# 5. Запуск
python manage.py runserver
```

---

## Первые шаги после запуска

### 1. Проверь API-ключ
Перейди в **Чат** → отправь сообщение "Привет". Если ответ пришёл — всё работает.

### 2. Добавь сервер
**Серверы → Добавить сервер**:
- Хост: IP или домен
- Порт: 22 (обычно)
- Логин: `root` или `ubuntu`
- Пароль или SSH-ключ (шифруется AES-256)

### 3. Запусти первого агента
**Агенты → Создать → Runtime: Ralph**

Попробуй простую задачу:
```
Проверь свободное место на всех серверах и выведи отчёт
```

Агент подключится по SSH, выполнит `df -h` и вернёт результат.

### 4. Загрузи документацию в базу знаний
**База знаний → Загрузить** → добавь runbook'и, регламенты, описания инфраструктуры.

В чате включи тумблер **RAG** — ИИ будет использовать загруженные документы.

---

## Полезные команды

```bash
# Логи Docker
docker compose logs -f web

# Перезапуск
docker compose restart web

# Миграции в Docker
docker exec weu-web python manage.py migrate

# Очистить кэш
docker exec weu-web python manage.py clear_cache

# Проверка здоровья API
curl http://localhost:9000/api/health/
```

---

## Что дальше

- [Конфигурация моделей](MODEL_SELECTION.md) — настройка Gemini/Grok
- [Архитектура](ARCHITECTURE.md) — как устроена платформа
- [HTTPS настройка](HTTPS_SETUP.md) — production-деплой с SSL
- [Возможности](FEATURES.md) — полный список фич
- [Веб-документация](http://localhost:9000/docs/ui-guide/) — интерактивная документация
