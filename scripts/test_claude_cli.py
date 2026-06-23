#!/usr/bin/env python
"""
Скрипт для проверки работоспособности Claude CLI.
Использовать для диагностики проблем с запуском Claude агента.
"""
import os
import subprocess
import sys
from pathlib import Path


def test_claude_cli():
    print("=" * 70)
    print("🧪 ТЕСТ РАБОТОСПОСОБНОСТИ CLAUDE CLI")
    print("=" * 70)

    # 1. Проверяем переменную окружения
    claude_path_env = os.getenv("CLAUDE_CLI_PATH", "").strip()
    print("\n1. Переменная окружения CLAUDE_CLI_PATH:")
    if claude_path_env:
        print(f"   ✅ Установлена: {claude_path_env}")
        claude_path = claude_path_env
    else:
        print("   ⚠️ НЕ установлена, ищем в PATH")
        claude_path = "claude"

    # 2. Проверяем наличие команды
    print("\n2. Поиск команды 'claude':")
    try:
        import shutil
        which_result = shutil.which(claude_path)
        if which_result:
            print(f"   ✅ Найдена: {which_result}")
            claude_path = which_result
        else:
            print("   ❌ НЕ найдена в PATH")
            if claude_path_env:
                print(f"   Проверяем путь из ENV: {claude_path_env}")
                if Path(claude_path_env).exists():
                    print("   ✅ Файл существует")
                    claude_path = claude_path_env
                else:
                    print("   ❌ Файл НЕ существует")
                    return False
            else:
                print("   ❌ Claude CLI не найден")
                return False
    except Exception as e:
        print(f"   ❌ Ошибка поиска: {e}")
        return False

    # 3. Проверяем что файл существует и исполняемый
    print("\n3. Проверка файла:")
    print(f"   Путь: {claude_path}")

    if not Path(claude_path).exists():
        print("   ❌ Файл НЕ существует")
        return False
    print("   ✅ Файл существует")

    if not os.access(claude_path, os.X_OK):
        print("   ⚠️ Файл НЕ имеет прав на выполнение")
        print(f"   Попробуйте: chmod +x {claude_path}")
    else:
        print("   ✅ Файл исполняемый")

    # 4. Пробуем запустить --version
    print(f"\n4. Запуск: {claude_path} --version")
    try:
        result = subprocess.run(
            [claude_path, "--version"],
            capture_output=True,
            text=True,
            timeout=10
        )

        print(f"   Exit code: {result.returncode}")

        if result.stdout:
            print("   STDOUT:")
            for line in result.stdout.strip().split('\n'):
                print(f"     {line}")

        if result.stderr:
            print("   STDERR:")
            for line in result.stderr.strip().split('\n'):
                print(f"     {line}")

        if result.returncode == 0:
            print("   ✅ Команда выполнена успешно")
        else:
            print(f"   ⚠️ Команда вернула код {result.returncode}")

    except subprocess.TimeoutExpired:
        print("   ❌ Timeout (10 секунд)")
        return False
    except Exception as e:
        print(f"   ❌ Ошибка запуска: {e}")
        return False

    # 5. Пробуем запустить с минимальным промптом
    print("\n5. Тест с минимальным промптом:")
    test_prompt = "Say 'hello'"
    print(f"   Запуск: {claude_path} -p '{test_prompt}'")

    try:
        result = subprocess.run(
            [claude_path, "-p", test_prompt],
            capture_output=True,
            text=True,
            timeout=30
        )

        print(f"   Exit code: {result.returncode}")

        if result.stdout:
            lines = result.stdout.strip().split('\n')
            print(f"   STDOUT ({len(lines)} строк):")
            for i, line in enumerate(lines[:10], 1):
                print(f"     [{i}] {line[:100]}")
            if len(lines) > 10:
                print(f"     ... и еще {len(lines) - 10} строк")

        if result.stderr:
            lines = result.stderr.strip().split('\n')
            print(f"   STDERR ({len(lines)} строк):")
            for i, line in enumerate(lines[:10], 1):
                print(f"     [{i}] {line[:100]}")

        if result.returncode == 0:
            print("   ✅ Тест выполнен успешно")
            return True
        elif result.returncode == -9:
            print("   ❌ Процесс был убит (SIGKILL) - возможно нехватка памяти")
            return False
        else:
            print(f"   ⚠️ Тест вернул код {result.returncode}")
            return False

    except subprocess.TimeoutExpired:
        print("   ❌ Timeout (30 секунд)")
        return False
    except Exception as e:
        print(f"   ❌ Ошибка запуска: {e}")
        return False

    print("\n" + "=" * 70)
    return True

if __name__ == "__main__":
    success = test_claude_cli()
    sys.exit(0 if success else 1)
