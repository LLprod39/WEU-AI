"""
WEU AI Agent - Views
Full-featured web interface for AI Agent system
"""
import asyncio
import json
import os
import shutil
import uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import AsyncGenerator
from django.shortcuts import render, redirect
from django.http import StreamingHttpResponse, JsonResponse, HttpResponseForbidden
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.views import LoginView
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods, require_GET
from django.conf import settings
from asgiref.sync import sync_to_async
from dotenv import load_dotenv
from loguru import logger

# Load environment variables
load_dotenv()

# Import core logic
from app.core.orchestrator import Orchestrator
from app.core.model_config import model_manager
from app.rag.engine import RAGEngine
from app.utils.file_processor import FileProcessor
from app.agents.manager import get_agent_manager
from core_ui.context_processors import user_can_feature
from core_ui.decorators import require_feature, async_login_required, async_require_feature
from core_ui.models import ChatSession, ChatMessage
from core_ui.middleware import get_template_name

# Singleton instances
_orchestrator = None
_orchestrator_lock = asyncio.Lock()
_rag_engine = None


def _init_orchestrator_sync():
    """Sync init оркестратора — вызывать только из asyncio.to_thread."""
    model_manager.load_config()
    return Orchestrator()


async def get_orchestrator():
    """Get or create orchestrator instance (protected by lock to avoid race condition)"""
    global _orchestrator
    async with _orchestrator_lock:
        if _orchestrator is None:
            _orchestrator = await asyncio.to_thread(_init_orchestrator_sync)
            await _orchestrator.initialize()
    return _orchestrator


def get_rag_engine():
    """Get or create RAG engine instance"""
    global _rag_engine
    if _rag_engine is None:
        _rag_engine = RAGEngine()
    return _rag_engine


# ============================================
# Health Check (no auth)
# ============================================

@csrf_exempt
@require_GET
def api_health(request):
    """
    Health check endpoint. No auth, no heavy checks (no LLM, no DB/network for RAG if avoidable).
    Returns: status ('ok'|'degraded'|'error'), timestamp (ISO), services: {django, rag}.
    """
    try:
        services = {'django': 'ok'}
        # RAG: use cached engine if already created (no heavy init), else treat as ok if import works
        try:
            if _rag_engine is not None:
                services['rag'] = 'ok' if _rag_engine.available else 'unavailable'
            else:
                # avoid get_rag_engine() here — it can do heavy init; module already imported
                services['rag'] = 'ok'
        except Exception:
            services['rag'] = 'unavailable'
        status = 'degraded' if services.get('rag') == 'unavailable' else 'ok'
        return JsonResponse({
            'status': status,
            'timestamp': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z',
            'services': services,
        })
    except Exception:
        return JsonResponse({
            'status': 'error',
            'timestamp': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z',
            'services': {'django': 'error', 'rag': 'unavailable'},
        }, status=500)


# ============================================
# Authentication Views
# ============================================

class CustomLoginView(LoginView):
    template_name = 'login.html'
    redirect_authenticated_user = True
    
    def get_template_names(self):
        """Return mobile or desktop login template based on device."""
        return [get_template_name(self.request, 'login.html')]


# ============================================
# Public / Semi-Public Landing
# ============================================

def welcome_view(request):
    """Public landing page: pitch, gallery, features, trust, CTA. No auth required."""
    return render(request, 'welcome.html')


def docs_ui_guide_view(request):
    """Documentation: UI guide. No auth required."""
    return render(request, 'docs_ui_guide.html')


# ============================================
# Main Page Views
# ============================================

@login_required
def index(request):
    """Main chat interface"""
    default_provider = model_manager.config.default_provider
    rag = get_rag_engine()
    context = {
        'default_provider': default_provider,
        'is_auto_default': default_provider == 'auto',
        'is_gemini_default': default_provider == 'gemini',
        'is_grok_default': default_provider == 'grok',
        'rag_available': rag.available,
        'rag_build': getattr(rag, 'rag_build', 'full'),
    }

    # Check for start_task_id
    task_id = request.GET.get('task_id')
    if task_id:
        try:
            # Lazy import to avoid circular dependency
            from tasks.models import Task
            task = Task.objects.get(id=task_id)
            initial_prompt = f"I need you to execute this task: '{task.title}'.\n\nDescription:\n{task.description}\n\nPlease analyze it and start working on it."
            context['initial_prompt'] = initial_prompt.replace('\n', '\\n').replace("'", "\\'")
        except Exception as exc:
            logger.warning(f"Failed to prefill task prompt for task_id={task_id}: {exc}")
    
    template = get_template_name(request, 'chat.html')
    return render(request, template, context)


@login_required
@require_feature('orchestrator', redirect_on_forbidden=True)
def orchestrator_view(request):
    """Orchestrator dashboard - shows agent workflow"""
    # Use cached orchestrator instance to avoid slow initialization
    # Tools will be loaded asynchronously via API
    context = {
        'tool_count': 0,  # Will be updated via API
    }
    template = get_template_name(request, 'orchestrator.html')
    return render(request, template, context)


@login_required
@require_feature('knowledge_base', redirect_on_forbidden=True)
def knowledge_base_view(request):
    """Knowledge Base (RAG) management - optimized for fast loading"""
    rag = get_rag_engine()
    rag_type = 'Qdrant' if (hasattr(rag, 'use_qdrant') and rag.use_qdrant) else ('InMemory' if rag.available else 'mini')
    context = {
        'documents': [],
        'doc_count': 0,
        'rag_available': rag.available,
        'rag_type': rag_type,
        'rag_build': getattr(rag, 'rag_build', 'full'),
    }
    template = get_template_name(request, 'knowledge_base.html')
    return render(request, template, context)


@login_required
def settings_view(request):
    """Settings page — конфиг подгружается через /api/settings/ и /api/models/. Only for staff or users with settings permission."""
    if not user_can_feature(request.user, 'settings'):
        return redirect('index')
    template = get_template_name(request, 'settings.html')
    return render(request, template, {})


# ============================================
# Settings: управление доступом (одна страница с вкладками)
# ============================================

def _get_access_data():
    """Данные для раздела «Управление доступом»."""
    from django.contrib.auth.models import User, Group
    from core_ui.models import UserAppPermission
    return {
        'users': User.objects.all().order_by('username'),
        'groups': Group.objects.all().prefetch_related('user_set').order_by('name'),
        'permissions': UserAppPermission.objects.select_related('user').all().order_by('user__username', 'feature'),
    }


@login_required
def settings_access_view(request):
    """Единая страница «Управление доступом» с вкладками: Пользователи, Группы, Права. Доступ: settings."""
    if not user_can_feature(request.user, 'settings'):
        return redirect('index')
    tab = request.GET.get('tab', 'users')
    if tab not in ('users', 'groups', 'permissions'):
        tab = 'users'
    ctx = _get_access_data()
    ctx['active_tab'] = tab
    return render(request, 'settings_access.html', ctx)


@login_required
def settings_users_view(request):
    """Редирект на единую страницу управления с вкладкой «Пользователи»."""
    if not user_can_feature(request.user, 'settings'):
        return redirect('index')
    from django.urls import reverse
    return redirect(reverse('settings_access') + '?tab=users')


@login_required
def settings_groups_view(request):
    """Редирект на единую страницу управления с вкладкой «Группы»."""
    if not user_can_feature(request.user, 'settings'):
        return redirect('index')
    from django.urls import reverse
    return redirect(reverse('settings_access') + '?tab=groups')


@login_required
def settings_permissions_view(request):
    """Редирект на единую страницу управления с вкладкой «Права»."""
    if not user_can_feature(request.user, 'settings'):
        return redirect('index')
    from django.urls import reverse
    return redirect(reverse('settings_access') + '?tab=permissions')


# ============================================
# Cursor CLI — Ask (--mode=ask) или Agent (без --mode; флаги -p --force stream-json ...)
# ask: agent --mode=ask -p --output-format text --workspace ... --model auto "..."
# agent: agent -p --force --output-format stream-json --stream-partial-output --workspace ... --model auto "..."
# ============================================

def _resolve_cursor_cli_command() -> str:
    """Путь к бинарнику Cursor CLI (agent). Аналогично agent_hub."""
    path_from_env = (os.getenv("CURSOR_CLI_PATH") or "").strip()
    if path_from_env:
        if Path(path_from_env).exists():
            return path_from_env
        raise FileNotFoundError(
            f"CURSOR_CLI_PATH задан, но файл не найден: {path_from_env}"
        )
    cfg = getattr(settings, "CLI_RUNTIME_CONFIG", None) or {}
    cursor_cfg = cfg.get("cursor") or {}
    cmd = cursor_cfg.get("command", "agent")
    if os.path.isabs(cmd):
        if not Path(cmd).exists():
            raise FileNotFoundError(f"Cursor CLI не найден: {cmd}")
        return cmd
    resolved = shutil.which(cmd)
    if not resolved:
        raise FileNotFoundError(
            "Cursor CLI (agent) не найден. Добавьте agent в PATH или задайте CURSOR_CLI_PATH."
        )
    return resolved


def _get_servers_context_for_prompt(user_id: int) -> str:
    """
    Возвращает контекст серверов пользователя для добавления в промпт Cursor CLI.
    Включает готовые команды SSH подключения с расшифрованными паролями (если MASTER_PASSWORD задан).
    """
    if not user_id:
        return ""
    try:
        from servers.models import Server
        from passwords.encryption import PasswordEncryption
        master_pwd = os.environ.get("MASTER_PASSWORD", "").strip()
        servers = list(Server.objects.filter(user_id=user_id).only(
            "id", "name", "host", "port", "username", "auth_method", "key_path", "encrypted_password", "salt"
        ))
        if not servers:
            return ""
        lines = [
            "\n\n=== СЕРВЕРЫ ПОЛЬЗОВАТЕЛЯ ===",
            "ВАЖНО: Данные серверов ниже. НЕ ищи их в коде!",
            "Для SSH-команд используй готовые команды подключения:",
            "",
        ]
        for s in servers:
            auth = s.auth_method or "password"
            key_path = s.key_path or ""
            pwd_decrypted = ""
            if auth in ("password", "key_password") and s.encrypted_password and master_pwd and s.salt:
                try:
                    pwd_decrypted = PasswordEncryption.decrypt_password(s.encrypted_password, master_pwd, bytes(s.salt))
                except Exception:
                    pwd_decrypted = ""
            if auth == "key" and key_path:
                cmd_hint = f"ssh -i {key_path} -o StrictHostKeyChecking=no {s.username}@{s.host} -p {s.port} '<COMMAND>'"
            elif pwd_decrypted:
                safe_pwd = pwd_decrypted.replace("'", "'\\''")
                cmd_hint = f"sshpass -p '{safe_pwd}' ssh -o StrictHostKeyChecking=no {s.username}@{s.host} -p {s.port} '<COMMAND>'"
            else:
                cmd_hint = f"ssh -o StrictHostKeyChecking=no {s.username}@{s.host} -p {s.port} '<COMMAND>'  # пароль недоступен"
            lines.append(f"• {s.name}:")
            lines.append(f"    {cmd_hint}")
        lines.append("")
        lines.append("Замени <COMMAND> на нужную команду (например df -h, hostname, uptime).")
        lines.append("sshpass установлен в системе.")
        lines.append("")
        return "\n".join(lines)
    except Exception as e:
        logger.warning(f"_get_servers_context_for_prompt error: {e}")
        return ""


async def _stream_cursor_cli(
    message: str,
    workspace: str,
    mode: str = "ask",
    sandbox: str = "",
    approve_mcps: bool = False,
) -> AsyncGenerator[str, None]:
    """
    Запускает Cursor CLI. Модель всегда auto.
    - ask: agent --mode=ask -p --output-format text --workspace ... --model auto "..."
    - agent: agent -p --force --output-format stream-json --stream-partial-output --workspace ... --model auto "..."
    """
    is_agent_mode = (mode or "").strip().lower() == "agent"
    cmd_path = _resolve_cursor_cli_command()
    base_dir = str(Path(workspace).resolve()) if workspace else str(Path(settings.BASE_DIR).resolve())
    env = dict(os.environ)
    extra = getattr(settings, "CURSOR_CLI_EXTRA_ENV", None) or {}
    env.update(extra)

    extra_flags = []
    if sandbox and (sandbox.strip().lower() in ("enabled", "disabled")):
        extra_flags.extend(["--sandbox", sandbox.strip().lower()])
    if approve_mcps:
        extra_flags.append("--approve-mcps")

    if is_agent_mode:
        args = [
            cmd_path,
            "-p",
            "--force",
            "--output-format",
            "stream-json",
            "--stream-partial-output",
            "--workspace",
            base_dir,
            "--model",
            "auto",
            *extra_flags,
            message,
        ]
    else:
        args = [
            cmd_path,
            "--mode=ask",
            "-p",
            "--output-format",
            "text",
            "--workspace",
            base_dir,
            "--model",
            "auto",
            *extra_flags,
            message,
        ]

    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=base_dir,
        env=env,
    )
    try:
        if proc.stdout:
            while True:
                chunk = await asyncio.wait_for(proc.stdout.read(8192), timeout=120.0)
                if not chunk:
                    break
                part = chunk.decode("utf-8", errors="replace")
                if part:
                    yield part
    except asyncio.TimeoutError:
        proc.kill()
        yield "\n\n⚠️ Cursor CLI превысил время ожидания (120 с)."
    finally:
        try:
            await asyncio.wait_for(proc.wait(), timeout=5.0)
        except (asyncio.TimeoutError, ProcessLookupError):
            try:
                proc.kill()
            except Exception:
                pass
        if proc.returncode and proc.returncode != 0 and proc.stderr:
            err = (await proc.stderr.read()).decode("utf-8", errors="replace").strip()
            if err:
                yield f"\n\n⚠️ Cursor CLI exit {proc.returncode}: {err[:500]}"


# ============================================
# API Endpoints
# ============================================

def _chat_history_from_session(session):
    """Build list of {role, content} from ChatMessage for orchestrator initial_history."""
    return [
        {"role": m.role, "content": m.content}
        for m in session.messages.order_by('created_at').only('role', 'content')
    ]


def _load_session(user_id, chat_id):
    """Sync helper: load ChatSession by user_id and chat_id. For use in asyncio.to_thread."""
    return ChatSession.objects.filter(user_id=user_id, id=chat_id).select_related().first()


@sync_to_async
def _get_server_names_for_user(user_id: int):
    """Синхронный запрос к ORM — вызывать только через sync_to_async из async-контекста."""
    from servers.models import Server
    return list(Server.objects.filter(user_id=user_id).values_list("name", flat=True))


async def _try_server_command_by_name(user_id: int, message: str):
    """
    Если в сообщении упомянут сервер из вкладки Servers по имени — выполнить команду по его данным и вернуть вывод.
    Возвращает строку результата или None, если «сервер по имени» не распознан.
    """
    import re
    try:
        from app.tools.server_tools import ServerExecuteTool
    except Exception:
        return None
    if not user_id or not (message or "").strip():
        return None
    try:
        msg = (message or "").strip().lower()
        # Список имён серверов пользователя (длинные первыми, чтобы «WEU SERVER» матчился раньше «WEU»)
        raw = await _get_server_names_for_user(user_id)
        names = sorted([n for n in raw if (n or "").strip()], key=lambda x: len((x or "").strip()), reverse=True)
        if not names:
            return None
        # Ищем упоминание имени сервера в тексте (регистронезависимо, как отдельное слово/фраза)
        chosen = None
        for name in names:
            n = (name or "").strip()
            if not n:
                continue
            pat = re.escape(n)
            if re.search(r"(^|[^\w])" + pat + r"([^\w]|$)", message, re.IGNORECASE):
                chosen = name
                break
        if not chosen:
            return None
        # Команда: по умолчанию df -h при «место»/«диск»; при «подключись» — проверка hostname; иначе из текста
        command = "df -h"
        if "место" in msg or "диск" in msg or "свободн" in msg:
            command = "df -h"
        elif "подключись" in msg or "подключиться" in msg:
            command = "hostname && echo OK"
        else:
            m = re.search(r"(?:выполни|запусти|команду)\s+([^\n.!?\]]+)", message, re.IGNORECASE)
            if m:
                cmd = m.group(1).strip().strip('"\'')
                if cmd and len(cmd) < 200:
                    command = cmd
            if "df" in msg and "df -h" not in command and "df " not in command:
                command = "df -h"
        tool = ServerExecuteTool()
        out = await tool.execute(
            server_name_or_id=chosen,
            command=command,
            _context={"user_id": user_id},
        )
        return (
            f"Результат на сервере «{chosen}» (данные из вкладки Servers):\n\n{out}"
            if isinstance(out, str)
            else str(out)
        )
    except Exception as e:
        logger.warning(f"server_command_by_name failed: {e}")
        return None


@csrf_exempt
@login_required
@require_http_methods(["GET"])
def api_chats_list(request):
    """Список чатов текущего пользователя."""
    try:
        sessions = ChatSession.objects.filter(user=request.user).order_by('-updated_at')[:50]
        items = [
            {"id": s.id, "title": s.title, "created_at": s.created_at.isoformat(), "updated_at": s.updated_at.isoformat()}
            for s in sessions
        ]
        return JsonResponse({"chats": items})
    except Exception as e:
        logger.error(f"api_chats_list: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def api_chats_create(request):
    """Создать новый чат. Body: {} или {"title": "..."}. Возвращает { "id", "title" }."""
    try:
        data = json.loads(request.body) if request.body else {}
        title = (data.get("title") or "").strip() or "Новый чат"
        session = ChatSession.objects.create(user=request.user, title=title)
        return JsonResponse({"id": session.id, "title": session.title})
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    except Exception as e:
        logger.error(f"api_chats_create: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["GET"])
def api_chat_detail(request, chat_id):
    """Получить чат по id с сообщениями. Доступ только к своим чатам."""
    try:
        session = ChatSession.objects.filter(user=request.user, id=chat_id).first()
        if not session:
            return JsonResponse({"error": "Not found"}, status=404)
        messages = [
            {"role": m.role, "content": m.content, "created_at": m.created_at.isoformat()}
            for m in session.messages.order_by('created_at')
        ]
        return JsonResponse({
            "id": session.id,
            "title": session.title,
            "created_at": session.created_at.isoformat(),
            "updated_at": session.updated_at.isoformat(),
            "messages": messages,
        })
    except Exception as e:
        logger.error(f"api_chat_detail: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@async_login_required
async def chat_api(request):
    """
    Async API endpoint for chat streaming.
    Expects JSON: { "message": "user input", "model": "auto|gemini|grok", "chat_id": null|int }
    model=auto → Cursor CLI; chat_id — сессия для истории и сохранения сообщений.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    try:
        data = json.loads(request.body)
        user_message = data.get('message', '')
        model = data.get('model', model_manager.config.default_provider)
        specific_model = data.get('specific_model')
        use_rag = data.get('use_rag', True)
        chat_id = data.get('chat_id')
        workspace_param = data.get('workspace', '').strip()  # Для IDE: имя проекта или относительный путь

        if not user_message:
            return JsonResponse({'error': 'Empty message'}, status=400)

        # request.user доступен только в sync-контексте — получаем user_id через sync_to_async
        user_id = await sync_to_async(
            lambda r: r.user.id if getattr(r.user, 'is_authenticated', False) else None
        )(request)

        # Загрузить сессию или подготовить создание новой (id отдадим в первом чанке)
        session = None
        initial_history = None
        if chat_id and user_id:
            session = await asyncio.to_thread(_load_session, user_id, chat_id)
            if session:
                initial_history = await asyncio.to_thread(_chat_history_from_session, session)

        async def event_stream():
            nonlocal session
            accumulated = []
            created_session_id = None  # новый id, если создали сессию в этом запросе
            try:
                if model == "auto":
                    if not session and user_id:
                        session = await asyncio.to_thread(
                            lambda: ChatSession.objects.create(
                                user_id=user_id,
                                title=(user_message[:80] or "Чат").strip() or "Чат",
                            )
                        )
                        created_session_id = session.id
                    # Попытка «по имени сервера» из вкладки Servers — без логина/пароля в чате
                    server_result = await _try_server_command_by_name(user_id, user_message)
                    if server_result is not None:
                        if created_session_id is not None:
                            yield f"CHAT_ID:{created_session_id}\n"
                        yield server_result
                        if user_id and session:
                            def _save_auto():
                                ChatMessage.objects.create(session=session, role=ChatMessage.ROLE_USER, content=user_message)
                                ChatMessage.objects.create(session=session, role=ChatMessage.ROLE_ASSISTANT, content=server_result)
                                session.title = (user_message[:80] or session.title).strip() or session.title
                                session.save(update_fields=["title", "updated_at"])
                            await asyncio.to_thread(_save_auto)
                        return
                    workspace = getattr(settings, "BASE_DIR", "")
                    cursor_mode = getattr(model_manager.config, "cursor_chat_mode", "ask") or "ask"
                    cursor_sandbox = getattr(model_manager.config, "cursor_sandbox", "") or ""
                    cursor_approve_mcps = getattr(model_manager.config, "cursor_approve_mcps", False)
                    # Добавляем контекст серверов пользователя в промпт для Cursor CLI
                    servers_ctx = await asyncio.to_thread(_get_servers_context_for_prompt, user_id) if user_id else ""
                    prompt_with_servers = (servers_ctx + "\n\n" + user_message) if servers_ctx else user_message
                    if created_session_id is not None:
                        yield f"CHAT_ID:{created_session_id}\n"
                    async for chunk in _stream_cursor_cli(
                        prompt_with_servers,
                        workspace,
                        mode=cursor_mode,
                        sandbox=cursor_sandbox,
                        approve_mcps=cursor_approve_mcps,
                    ):
                        accumulated.append(chunk)
                        yield chunk
                    full_text = "".join(accumulated)
                    if user_id and session:
                        def _save_auto():
                            ChatMessage.objects.create(session=session, role=ChatMessage.ROLE_USER, content=user_message)
                            ChatMessage.objects.create(session=session, role=ChatMessage.ROLE_ASSISTANT, content=full_text)
                            session.title = (user_message[:80] or session.title).strip() or session.title
                            session.save(update_fields=["title", "updated_at"])
                        await asyncio.to_thread(_save_auto)
                    return
                if not session and user_id:
                    session = await asyncio.to_thread(
                        lambda: ChatSession.objects.create(
                            user_id=user_id,
                            title=(user_message[:80] or "Новый чат").strip() or "Новый чат",
                        )
                    )
                    created_session_id = session.id
                if created_session_id is not None:
                    yield f"CHAT_ID:{created_session_id}\n"
                
                # Разрешаем workspace если передан
                workspace_path = None
                if workspace_param:
                    try:
                        workspace_root = await asyncio.to_thread(_resolve_ide_workspace, workspace_param)
                        workspace_path = str(workspace_root)
                    except ValueError as e:
                        yield f"\n\n❌ Ошибка workspace: {e}\n"
                        return
                
                # Формируем execution_context (IDE: без RAG и без лишнего контекста серверов)
                execution_context = {}
                if user_id:
                    execution_context["user_id"] = user_id
                if workspace_path:
                    execution_context["workspace_path"] = workspace_path
                    execution_context["from_ide"] = True
                
                # В режиме IDE не подмешиваем RAG (чтобы не тянуть чек-листы и посторонние данные)
                use_rag_effective = use_rag if not workspace_path else False
                
                orchestrator = await get_orchestrator()
                async for chunk in orchestrator.process_user_message(
                    user_message,
                    model_preference=model,
                    use_rag=use_rag_effective,
                    specific_model=specific_model,
                    user_id=user_id,
                    initial_history=initial_history,
                    execution_context=execution_context if execution_context else None,
                ):
                    accumulated.append(chunk)
                    yield chunk
                full_text = "".join(accumulated)
                if user_id and session:
                    def _save():
                        ChatMessage.objects.create(session=session, role=ChatMessage.ROLE_USER, content=user_message)
                        ChatMessage.objects.create(session=session, role=ChatMessage.ROLE_ASSISTANT, content=full_text)
                        session.title = (user_message[:80] or session.title).strip() or session.title
                        session.save(update_fields=["title", "updated_at"])
                    await asyncio.to_thread(_save)
            except FileNotFoundError as e:
                yield f"\n\n❌ {e}"
            except Exception as e:
                yield f"\n\n❌ Error: {str(e)}"

        return StreamingHttpResponse(event_stream(), content_type='text/plain; charset=utf-8')

    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('knowledge_base')
@require_http_methods(["POST"])
def rag_add_api(request):
    """Add text to RAG knowledge base"""
    try:
        data = json.loads(request.body)
        text = data.get('text', '')
        source = data.get('source', 'manual')
        
        if not text:
            return JsonResponse({'success': False, 'error': 'Empty text'}, status=400)
        
        rag = get_rag_engine()
        if not rag.available:
            return JsonResponse({'success': False, 'error': 'RAG not available'}, status=503)
        
        doc_id = rag.add_text(text, source, user_id=request.user.id)
        
        if doc_id is None:
            return JsonResponse({
                'success': False,
                'error': 'Failed to add document to RAG'
            }, status=500)
        
        return JsonResponse({
            'success': True,
            'doc_id': doc_id,
            'message': 'Document added successfully'
        })
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        logger.error(f"Error in rag_add_api: {e}")
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('knowledge_base')
@require_http_methods(["POST"])
def rag_query_api(request):
    """Query RAG knowledge base"""
    try:
        data = json.loads(request.body)
        query = data.get('query', '')
        n_results = data.get('n_results', 5)
        
        if not query:
            return JsonResponse({'success': False, 'error': 'Empty query'}, status=400)
        
        rag = get_rag_engine()
        if not rag.available:
            return JsonResponse({
                'success': False,
                'error': 'RAG not available',
                'documents': [[]],
                'metadatas': [[]]
            }, status=503)
        
        try:
            results = rag.query(query, n_results, user_id=request.user.id)
            
            return JsonResponse({
                'success': True,
                'documents': results.get('documents', [[]]),
                'metadatas': results.get('metadatas', [[]])
            })
        except Exception as query_error:
            logger.error(f"Error querying RAG: {query_error}")
            return JsonResponse({
                'success': False,
                'error': f'Query failed: {str(query_error)}',
                'documents': [[]],
                'metadatas': [[]]
            }, status=500)
    except json.JSONDecodeError:
        return JsonResponse({
            'success': False,
            'error': 'Invalid JSON',
            'documents': [[]],
            'metadatas': [[]]
        }, status=400)
    except Exception as e:
        logger.error(f"Error in rag_query_api: {e}")
        return JsonResponse({
            'success': False,
            'error': str(e),
            'documents': [[]],
            'metadatas': [[]]
        }, status=500)


@csrf_exempt
@login_required
@require_feature('knowledge_base')
@require_http_methods(["POST"])
def rag_reset_api(request):
    """Reset RAG database"""
    try:
        rag = get_rag_engine()
        if not rag.available:
            return JsonResponse({'success': False, 'error': 'RAG not available'}, status=503)
        
        try:
            rag.reset_db(user_id=request.user.id)
            return JsonResponse({
                'success': True,
                'message': 'Database reset successfully'
            })
        except Exception as reset_error:
            logger.error(f"Error resetting RAG: {reset_error}")
            return JsonResponse({
                'success': False,
                'error': f'Reset failed: {str(reset_error)}'
            }, status=500)
    except Exception as e:
        logger.error(f"Error in rag_reset_api: {e}")
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('knowledge_base')
@require_http_methods(["POST"])
def rag_delete_api(request):
    """Delete a single document by id"""
    try:
        data = json.loads(request.body) if request.body else {}
        doc_id = data.get('doc_id') or data.get('id')
        if not doc_id:
            return JsonResponse({'success': False, 'error': 'doc_id required'}, status=400)
        rag = get_rag_engine()
        if not rag.available:
            return JsonResponse({'success': False, 'error': 'RAG not available'}, status=503)
        removed = rag.delete_document(str(doc_id), user_id=request.user.id)
        if removed:
            return JsonResponse({'success': True, 'message': 'Document deleted'})
        return JsonResponse({'success': False, 'error': 'Document not found'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        logger.error(f"Error in rag_delete_api: {e}")
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required
@require_feature('knowledge_base')
def rag_documents_api(request):
    """Get documents from RAG with pagination - optimized for performance"""
    try:
        rag = get_rag_engine()
        if not rag.available:
            return JsonResponse({
                'success': False,
                'error': 'RAG not available',
                'documents': [],
                'doc_count': 0
            })
        
        # Get pagination parameters
        limit = int(request.GET.get('limit', 50))  # Default 50 documents
        offset = int(request.GET.get('offset', 0))
        
        # Get documents (limited for performance)
        all_documents = rag.get_documents(limit=limit + offset, user_id=request.user.id)
        
        # Apply pagination
        documents = all_documents[offset:offset + limit]
        total_count = len(all_documents) if offset == 0 else len(all_documents)
        
        return JsonResponse({
            'success': True,
            'documents': documents,
            'doc_count': total_count,
            'has_more': len(all_documents) > offset + limit
        })
    except Exception as e:
        logger.error(f"Error getting documents: {e}")
        return JsonResponse({
            'success': False,
            'error': str(e),
            'documents': [],
            'doc_count': 0
        })


@login_required
@require_feature('orchestrator')
def api_tools_list(request):
    """Get list of available tools - uses get_orchestrator() with initialize(), no direct Orchestrator creation"""
    try:
        orchestrator = asyncio.run(get_orchestrator())
        tools = orchestrator.get_available_tools()
        return JsonResponse({'tools': tools, 'count': len(tools)})
    except Exception as e:
        logger.error(f"Error loading tools: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def api_models_list(request):
    """Get list of available models for dropdowns"""
    try:
        gemini_models = model_manager.get_available_models('gemini')
        grok_models = model_manager.get_available_models('grok')
        c = model_manager.config
        return JsonResponse({
            'gemini': gemini_models,
            'grok': grok_models,
            'rag_defaults': [
                'models/text-embedding-004',
                'models/text-embedding-005',
                'models/embedding-001',
            ],
            'current': {
                'chat_gemini': c.chat_model_gemini,
                'chat_grok': c.chat_model_grok,
                'rag_model': c.rag_model,
                'agent_model_gemini': c.agent_model_gemini,
                'agent_model_grok': c.agent_model_grok,
                'default_provider': c.default_provider,
            }
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def api_clear_history(request):
    """Clear conversation history - uses get_orchestrator() for consistent access"""
    try:
        orchestrator = asyncio.run(get_orchestrator())
        orchestrator.clear_history()
        return JsonResponse({'success': True, 'message': 'History cleared'})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["GET", "POST"])
def api_settings(request):
    """GET: return full settings config. POST: update settings. Only for staff or users with settings permission."""
    if not user_can_feature(request.user, 'settings'):
        return JsonResponse({'error': 'Forbidden'}, status=403)
    if request.method == 'GET':
        try:
            model_manager.load_config()
            c = model_manager.config
            delegate_ui = 'chat'
            try:
                from tasks.models import UserDelegatePreference
                pref = UserDelegatePreference.objects.filter(user=request.user).first()
                if pref:
                    delegate_ui = pref.delegate_ui
            except Exception:
                pass
            return JsonResponse({
                'success': True,
                'config': {
                    'default_provider': c.default_provider,
                    'internal_llm_provider': getattr(c, 'internal_llm_provider', 'grok') or 'grok',
                    'chat_model_gemini': c.chat_model_gemini,
                    'chat_model_grok': c.chat_model_grok,
                    'rag_model': c.rag_model,
                    'agent_model_gemini': c.agent_model_gemini,
                    'agent_model_grok': c.agent_model_grok,
                    'default_agent_output_path': getattr(c, 'default_agent_output_path', '') or '',
                    'cursor_chat_mode': getattr(c, 'cursor_chat_mode', 'ask') or 'ask',
                    'cursor_sandbox': getattr(c, 'cursor_sandbox', '') or '',
                    'cursor_approve_mcps': getattr(c, 'cursor_approve_mcps', False),
                    'allow_model_selection': getattr(c, 'allow_model_selection', False),
                    'delegate_ui': delegate_ui,
                },
                'api_keys': {
                    'gemini_set': bool(os.getenv('GEMINI_API_KEY')),
                    'grok_set': bool(os.getenv('GROK_API_KEY')),
                },
            })
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)

    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            allowed = {
                'default_provider', 'chat_model_gemini', 'chat_model_grok',
                'rag_model', 'agent_model_gemini', 'agent_model_grok',
                'default_agent_output_path', 'cursor_chat_mode',
                'cursor_sandbox', 'cursor_approve_mcps',
                'internal_llm_provider',  # Провайдер для внутренних вызовов (workflow, анализ)
                'allow_model_selection',  # Разрешить выбор моделей в workflow
            }
            for key, value in data.items():
                if key in allowed and value is not None:
                    model_manager.update_config(**{key: value})
            model_manager.save_config()
            # Per-user delegate_ui preference
            if 'delegate_ui' in data and data['delegate_ui'] in ('chat', 'task_form'):
                from tasks.models import UserDelegatePreference
                UserDelegatePreference.objects.update_or_create(
                    user=request.user,
                    defaults={'delegate_ui': data['delegate_ui']},
                )
            return JsonResponse({'success': True, 'message': 'Settings updated'})
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)

    return JsonResponse({'error': 'Method not allowed'}, status=405)


@login_required
@require_GET
def api_settings_check(request):
    """
    GET /api/settings/check/
    Returns: { configured: true|false, missing: ['gemini_key','grok_key'] }
    Checks that API keys in settings are non-empty. Only for users with settings permission.
    """
    if not user_can_feature(request.user, 'settings'):
        return JsonResponse({'configured': False, 'missing': ['gemini_key', 'grok_key']}, status=403)
    try:
        gemini_ok = bool((os.getenv('GEMINI_API_KEY') or '').strip())
        grok_ok = bool((os.getenv('GROK_API_KEY') or '').strip())
        missing = []
        if not gemini_ok:
            missing.append('gemini_key')
        if not grok_ok:
            missing.append('grok_key')
        return JsonResponse({
            'configured': len(missing) == 0,
            'missing': missing,
        })
    except Exception as e:
        logger.exception('api_settings_check error: %s', e)
        return JsonResponse({'configured': False, 'missing': ['gemini_key', 'grok_key']}, status=500)


@login_required
@require_feature('agents')
def api_agents_list(request):
    """Get list of available agents"""
    try:
        agent_manager = get_agent_manager()
        agents = agent_manager.list_agents()
        return JsonResponse({'agents': agents})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@async_login_required
@async_require_feature('agents')
@require_http_methods(["POST"])
async def api_agent_execute(request):
    """Execute an agent with a task"""
    try:
        data = json.loads(request.body)
        agent_name = data.get('agent_name')
        task = data.get('task')
        context = data.get('context', {})
        
        if not agent_name or not task:
            return JsonResponse({'error': 'agent_name and task are required'}, status=400)
        
        agent_manager = get_agent_manager()
        result = await agent_manager.execute_agent(agent_name, task, context)
        
        return JsonResponse(result)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('knowledge_base')
@require_http_methods(["POST"])
def api_upload_file(request):
    """Upload file and add to RAG"""
    try:
        if 'file' not in request.FILES:
            return JsonResponse({'error': 'No file provided'}, status=400)
        
        uploaded_file = request.FILES['file']
        filename = uploaded_file.name
        
        # Check if file type is supported
        if not FileProcessor.is_supported(filename):
            return JsonResponse({
                'error': f'Unsupported file type. Supported: {", ".join(FileProcessor.SUPPORTED_EXTENSIONS.keys())}'
            }, status=400)
        
        # Generate unique filename
        file_ext = Path(filename).suffix
        unique_filename = f"{uuid.uuid4()}{file_ext}"
        file_path = settings.UPLOADED_FILES_DIR / unique_filename
        
        # Save file
        with open(file_path, 'wb') as f:
            for chunk in uploaded_file.chunks():
                f.write(chunk)
        
        # Process file and extract text
        result = FileProcessor.process_file(str(file_path), filename)
        
        if result['error']:
            # Delete file if processing failed
            try:
                os.remove(file_path)
            except Exception as exc:
                logger.warning(f"Failed to remove uploaded file {file_path}: {exc}")
            return JsonResponse({'error': result['error']}, status=400)
        
        # Add to RAG
        rag = get_rag_engine()
        if rag.available and result['text']:
            doc_id = rag.add_text(
                result['text'],
                source=f"upload:{filename}",
                user_id=request.user.id
            )
            result['metadata']['rag_doc_id'] = doc_id
        
        return JsonResponse({
            'success': True,
            'filename': filename,
            'text_preview': result['text'][:500] + '...' if len(result['text']) > 500 else result['text'],
            'text_length': len(result['text']),
            'metadata': result['metadata']
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


# ============================================
# IDE API (Web IDE with file tree and editor)
# ============================================

def _resolve_ide_workspace(workspace_param: str) -> Path:
    """
    Разрешает workspace параметр в безопасный Path внутри AGENT_PROJECTS_DIR.
    
    Args:
        workspace_param: имя проекта (папка в AGENT_PROJECTS_DIR) или относительный путь
        
    Returns:
        Path к workspace директории
        
    Raises:
        ValueError: если путь выходит за пределы AGENT_PROJECTS_DIR
    """
    if not workspace_param or not workspace_param.strip():
        raise ValueError("workspace parameter is required")
    
    # Нормализуем: убираем начальные/конечные слеши и точки
    normalized = workspace_param.strip().strip('/').strip('\\')
    
    # Защита от путей с ..
    if '..' in normalized or normalized.startswith('/'):
        raise ValueError("Invalid workspace path")
    
    # Собираем полный путь
    projects_dir = Path(settings.AGENT_PROJECTS_DIR)
    workspace_path = projects_dir / normalized
    
    # Проверяем, что итоговый путь находится внутри AGENT_PROJECTS_DIR
    try:
        resolved = workspace_path.resolve()
        projects_resolved = projects_dir.resolve()
        
        # Проверка через is_relative_to (Python 3.9+)
        if not str(resolved).startswith(str(projects_resolved)):
            raise ValueError(f"Workspace path must be within AGENT_PROJECTS_DIR")
    except Exception as e:
        if isinstance(e, ValueError):
            raise
        raise ValueError(f"Invalid workspace path: {e}")
    
    return workspace_path


@login_required
@require_feature('orchestrator')
@require_http_methods(["GET"])
def api_ide_list_files(request):
    """
    GET /api/ide/files/
    Параметры: workspace (имя проекта), path (относительный путь внутри проекта, по умолчанию "")
    Возвращает список файлов и папок в указанной директории.
    """
    try:
        workspace_param = request.GET.get('workspace', '').strip()
        path_param = request.GET.get('path', '').strip()
        
        if not workspace_param:
            return JsonResponse({'error': 'workspace parameter is required'}, status=400)
        
        # Разрешаем workspace
        try:
            workspace_root = _resolve_ide_workspace(workspace_param)
        except ValueError as e:
            return JsonResponse({'error': str(e)}, status=403)
        
        # Нормализуем path внутри workspace
        if path_param:
            # Убираем начальные слеши
            path_param = path_param.strip('/').strip('\\')
            # Защита от ..
            if '..' in path_param:
                return JsonResponse({'error': 'Invalid path'}, status=400)
            target_path = workspace_root / path_param
        else:
            target_path = workspace_root
        
        # Проверяем, что target_path всё ещё внутри workspace_root
        try:
            target_resolved = target_path.resolve()
            workspace_resolved = workspace_root.resolve()
            if not str(target_resolved).startswith(str(workspace_resolved)):
                return JsonResponse({'error': 'Path outside workspace'}, status=403)
        except Exception:
            return JsonResponse({'error': 'Invalid path'}, status=400)
        
        # Проверяем существование
        if not target_path.exists():
            return JsonResponse({'error': 'Path not found'}, status=404)
        
        if not target_path.is_dir():
            return JsonResponse({'error': 'Path is not a directory'}, status=400)
        
        # Собираем список файлов и папок
        files = []
        try:
            for item in sorted(target_path.iterdir()):
                # Пропускаем скрытые файлы/папки (начинающиеся с .)
                if item.name.startswith('.'):
                    continue
                
                item_type = 'dir' if item.is_dir() else 'file'
                # Относительный путь от workspace_root
                rel_path = item.relative_to(workspace_root)
                files.append({
                    'name': item.name,
                    'path': str(rel_path).replace('\\', '/'),  # Нормализуем слеши
                    'type': item_type,
                })
        except PermissionError:
            return JsonResponse({'error': 'Permission denied'}, status=403)
        except Exception as e:
            logger.error(f"Error listing directory {target_path}: {e}")
            return JsonResponse({'error': str(e)}, status=500)
        
        return JsonResponse({'files': files})
        
    except Exception as e:
        logger.error(f"api_ide_list_files error: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_feature('orchestrator')
@require_http_methods(["GET"])
def api_ide_read_file(request):
    """
    GET /api/ide/file/
    Параметры: workspace (имя проекта), path (относительный путь к файлу)
    Возвращает содержимое файла.
    """
    try:
        workspace_param = request.GET.get('workspace', '').strip()
        path_param = request.GET.get('path', '').strip()
        
        if not workspace_param or not path_param:
            return JsonResponse({'error': 'workspace and path parameters are required'}, status=400)
        
        # Разрешаем workspace
        try:
            workspace_root = _resolve_ide_workspace(workspace_param)
        except ValueError as e:
            return JsonResponse({'error': str(e)}, status=403)
        
        # Нормализуем path
        path_param = path_param.strip('/').strip('\\')
        if '..' in path_param:
            return JsonResponse({'error': 'Invalid path'}, status=400)
        
        file_path = workspace_root / path_param
        
        # Проверяем безопасность пути
        try:
            file_resolved = file_path.resolve()
            workspace_resolved = workspace_root.resolve()
            if not str(file_resolved).startswith(str(workspace_resolved)):
                return JsonResponse({'error': 'Path outside workspace'}, status=403)
        except Exception:
            return JsonResponse({'error': 'Invalid path'}, status=400)
        
        # Проверяем существование и что это файл
        if not file_path.exists():
            return JsonResponse({'error': 'File not found'}, status=404)
        
        if not file_path.is_file():
            return JsonResponse({'error': 'Path is not a file'}, status=400)
        
        # Читаем файл
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except UnicodeDecodeError:
            # Пробуем как бинарный файл
            return JsonResponse({'error': 'File is not a text file'}, status=400)
        except PermissionError:
            return JsonResponse({'error': 'Permission denied'}, status=403)
        except Exception as e:
            logger.error(f"Error reading file {file_path}: {e}")
            return JsonResponse({'error': str(e)}, status=500)
        
        from django.http import HttpResponse
        response = HttpResponse(content, content_type='text/plain; charset=utf-8')
        return response
        
    except Exception as e:
        logger.error(f"api_ide_read_file error: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('orchestrator')
@require_http_methods(["PUT", "POST"])
def api_ide_write_file(request):
    """
    PUT/POST /api/ide/file/
    Тело: JSON { "workspace": "...", "path": "...", "content": "..." }
    Или query: workspace, path; тело: content (text/plain)
    Создаёт или обновляет файл в workspace.
    """
    try:
        # Парсим данные из JSON или form
        if request.content_type and 'application/json' in request.content_type:
            data = json.loads(request.body)
            workspace_param = data.get('workspace', '').strip()
            path_param = data.get('path', '').strip()
            content = data.get('content', '')
        else:
            workspace_param = request.GET.get('workspace', '').strip()
            path_param = request.GET.get('path', '').strip()
            content = request.body.decode('utf-8') if request.body else ''
        
        if not workspace_param or not path_param:
            return JsonResponse({'error': 'workspace and path parameters are required'}, status=400)
        
        # Разрешаем workspace
        try:
            workspace_root = _resolve_ide_workspace(workspace_param)
        except ValueError as e:
            return JsonResponse({'error': str(e)}, status=403)
        
        # Нормализуем path
        path_param = path_param.strip('/').strip('\\')
        if '..' in path_param:
            return JsonResponse({'error': 'Invalid path'}, status=400)
        
        file_path = workspace_root / path_param
        
        # Проверяем безопасность пути
        try:
            file_resolved = file_path.resolve()
            workspace_resolved = workspace_root.resolve()
            if not str(file_resolved).startswith(str(workspace_resolved)):
                return JsonResponse({'error': 'Path outside workspace'}, status=403)
        except Exception:
            return JsonResponse({'error': 'Invalid path'}, status=400)
        
        # Создаём родительские директории если нужно
        try:
            file_path.parent.mkdir(parents=True, exist_ok=True)
        except PermissionError:
            return JsonResponse({'error': 'Permission denied'}, status=403)
        except Exception as e:
            logger.error(f"Error creating parent directories for {file_path}: {e}")
            return JsonResponse({'error': str(e)}, status=500)
        
        # Записываем файл
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
        except PermissionError:
            return JsonResponse({'error': 'Permission denied'}, status=403)
        except Exception as e:
            logger.error(f"Error writing file {file_path}: {e}")
            return JsonResponse({'error': str(e)}, status=500)
        
        return JsonResponse({
            'success': True,
            'path': str(file_path.relative_to(workspace_root)).replace('\\', '/'),
            'message': 'File saved successfully'
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        logger.error(f"api_ide_write_file error: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_feature('orchestrator')
def ide_view(request):
    """
    Страница веб-IDE с редактором кода, деревом файлов и чатом.
    """
    # Получаем проект из query параметра если есть
    project = request.GET.get('project', '').strip()
    
    context = {
        'project': project,
    }
    
    return render(request, 'ide.html', context)
