#!/usr/bin/env python
"""Проверка api/health: path, view, JSON status+timestamp."""
import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'web_ui.settings')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
django.setup()

from django.test import Client

client = Client()
resp = client.get('/api/health/')
data = resp.json()
ok = (
    resp.status_code == 200
    and 'status' in data
    and 'timestamp' in data
)
if ok:
    print('<promise>PASS</promise>')
else:
    print('FAIL', resp.status_code, data)
