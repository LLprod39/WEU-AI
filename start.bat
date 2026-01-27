@echo off
chcp 65001 > nul
cls

echo.
echo  ╔═══════════════════════════════════════════════════════════╗
echo  ║              WEU AI Agent - Quick Start                   ║
echo  ║                   Enterprise Edition                      ║
echo  ╚═══════════════════════════════════════════════════════════╝
echo.

:: Check Python
python --version > nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Python is not installed or not in PATH
    pause
    exit /b 1
)

:: Check virtual environment
if not exist "venv" (
    echo  [*] Creating virtual environment...
    python -m venv venv
)

:: Activate virtual environment
echo  [*] Activating virtual environment...
call venv\Scripts\activate.bat

:: Install dependencies
echo  [*] Checking dependencies...
pip install -r requirements.txt -q

:: Check .env
if not exist ".env" (
    echo.
    echo  [WARNING] .env file not found!
    echo  Please create .env file with:
    echo    GEMINI_API_KEY=your_key_here
    echo    GROK_API_KEY=your_key_here
    echo.
)

:: Run migrations
echo  [*] Applying database migrations...
python manage.py migrate --run-syncdb -v 0

:: Check if superuser exists
python -c "import os; os.environ['DJANGO_SETTINGS_MODULE']='web_ui.settings'; import django; django.setup(); from django.contrib.auth.models import User; exit(0 if User.objects.exists() else 1)" > nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [*] Creating admin user...
    echo  Username: admin
    echo  Password: admin123
    python -c "import os; os.environ['DJANGO_SETTINGS_MODULE']='web_ui.settings'; import django; django.setup(); from django.contrib.auth.models import User; User.objects.create_superuser('admin', 'admin@localhost', 'admin123') if not User.objects.filter(username='admin').exists() else None"
    echo.
)

:: Get port from environment variable or use default
if defined DJANGO_PORT (
    set SERVER_PORT=%DJANGO_PORT%
) else (
    set SERVER_PORT=9000
)

echo.
echo  ╔═══════════════════════════════════════════════════════════╗
echo  ║                   Starting Server                         ║
echo  ╠═══════════════════════════════════════════════════════════╣
echo  ║  URL:      http://localhost:%SERVER_PORT%                  ║
echo  ║  Login:    admin / admin123                               ║
echo  ║  Stop:     Press Ctrl+C                                   ║
echo  ╚═══════════════════════════════════════════════════════════╝
echo.

:: Start Django server
python manage.py runserver %SERVER_PORT%
