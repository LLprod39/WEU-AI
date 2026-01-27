#!/usr/bin/env python3
"""
Запуск проверки страницы
"""
import subprocess
import sys
from pathlib import Path

script_path = Path(__file__).parent / 'check_page.py'
result = subprocess.run([sys.executable, str(script_path)], 
                       capture_output=True, 
                       text=True,
                       cwd=str(Path(__file__).parent))

print(result.stdout, end='')
if result.stderr:
    print(result.stderr, file=sys.stderr, end='')

sys.exit(result.returncode)
