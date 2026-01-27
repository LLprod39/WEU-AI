#!/usr/bin/env python3
"""
UI smoke-тест: базовая навигация — все основные страницы отвечают 200 или 302.
Запуск: python test_ui_smoke.py [BASE_URL]
Без аргумента — через Django test client (сервер не нужен).
С BASE_URL (напр. http://127.0.0.1:8000) — проверка живого сервера.
"""
import os
import sys

if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from smoke_test import main
    main()
