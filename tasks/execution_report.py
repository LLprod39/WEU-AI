"""
Генерация структурированного отчёта о выполнении задачи из AgentWorkflowRun.
После выполнения шагов LLM генерирует краткий понятный отчёт (что сделано, команды, ошибки).
"""
from django.utils import timezone
from loguru import logger

# Максимум символов логов в контексте для LLM
SUMMARY_LOGS_MAX_CHARS = 3500


def _build_context_for_summary(run_obj) -> str:
    """Собирает компактный контекст для LLM: шаги (название + статус), конец логов, ошибки."""
    step_results = run_obj.step_results or []
    logs = (run_obj.logs or "").strip()
    workflow_name = (run_obj.workflow.name if run_obj.workflow_id else "") or "Workflow"

    lines = [
        f"Workflow: {workflow_name}",
        f"Итог выполнения: {run_obj.status}",
        "",
        "Шаги:",
    ]
    for sr in step_results:
        title = sr.get("step", "?")
        status = sr.get("status", "?")
        err = sr.get("error", "")
        line = f"  - {title}: {status}"
        if err:
            line += f" — {err[:200]}"
        lines.append(line)

    lines.append("")
    lines.append("Фрагмент лога выполнения (конец):")
    if logs:
        excerpt = logs[-SUMMARY_LOGS_MAX_CHARS:] if len(logs) > SUMMARY_LOGS_MAX_CHARS else logs
        lines.append(excerpt)
    else:
        lines.append("(лог пуст)")

    return "\n".join(lines)


async def _generate_summary_async(context: str) -> str:
    """Вызов LLM для генерации краткого отчёта. Возвращает один текст."""
    from app.core.llm import LLMProvider
    from app.core.model_config import model_manager

    prompt = """По данным выполнения задачи напиши КРАТКИЙ отчёт для человека.

ФОРМАТ (строго):
1) Одна строка — итог (успешно / с замечаниями / ошибка).
2) Блок «Результаты» — список пунктов с ФАКТАМИ и ЦИФРАМИ из лога:
   - Место на диске: если в логе есть вывод df — укажи размер, занято, свободно, % для корня/дисков.
   - Логи: что проверено (journalctl, ошибки) — в 1 строку.
   - Другие выполненные шаги — по одному пункту.
3) Если есть ошибки — отдельно коротким списком.

Запрещено: длинные абзацы, повторения, технический дамп (промпты, JSON). Только факты из лога, цифры, короткие пункты.

Данные выполнения:
"""
    prompt += context

    provider = model_manager.config.internal_llm_provider or "grok"
    llm = LLMProvider()
    chunks = []
    try:
        async for chunk in llm.stream_chat(prompt, model=provider):
            chunks.append(chunk)
    except Exception as e:
        logger.warning(f"LLM stream_chat for report summary failed: {e}")
        return ""
    result = "".join(chunks).strip()
    if result.startswith("Error"):
        return ""
    return result


def generate_executive_summary(run_obj) -> str:
    """
    Генерирует краткий отчёт после выполнения шагов.
    Передаём контекст (шаги, логи) в LLM — получаем понятный текст «что сделано».
    """
    context = _build_context_for_summary(run_obj)
    try:
        from asgiref.sync import async_to_sync
        return async_to_sync(_generate_summary_async)(context) or ""
    except Exception as e:
        logger.warning(f"Executive summary generation failed: {e}")
        return ""


def build_execution_report_from_run(run_obj) -> dict:
    """
    Строит отчёт о выполнении из run_obj (AgentWorkflowRun).

    Использует step_results, logs, meta, log_events.
    """
    step_results = run_obj.step_results or []
    meta = run_obj.meta or {}
    logs = run_obj.logs or ""

    steps = []
    findings = []
    problems = []

    for sr in step_results:
        step_idx = sr.get("step_idx")
        title = sr.get("step", f"Шаг {step_idx}")
        status = sr.get("status", "unknown")
        error = sr.get("error")
        result = sr.get("result") or {}

        commands = []
        if isinstance(result, dict) and result.get("command"):
            commands.append(result["command"])
        cmd_key = f"step_{step_idx}_cmd"
        if meta.get(cmd_key):
            commands.append(meta[cmd_key])

        output_preview = None
        if isinstance(result, dict) and result.get("output"):
            out = result["output"]
            output_preview = (out[:1500] + "…") if len(out) > 1500 else out

        steps.append({
            "title": title,
            "status": "completed" if status == "completed" else "failed" if status == "failed" else "skipped",
            "commands": commands or [],
            "output_preview": output_preview,
            "error": error,
            "retries": sr.get("retries", 0),
        })
        if error:
            problems.append(f"[{title}] {error}")
        # Из вывода шага извлекаем короткие факты для блока «Находки»
        if output_preview and status == "completed":
            out = output_preview.strip()
            if "Filesystem" in out and ("GIB" in out or "Mounted" in out or "%" in out):
                for line in out.split("\n"):
                    line = line.strip()
                    if line.startswith("/") and ("%" in line or "GIB" in line or "M " in line):
                        findings.append(f"Диск: {line[:80]}" + ("…" if len(line) > 80 else ""))
                        break
            if "journalctl" in (sr.get("step", "") + out) and not any(f.startswith("Логи:") for f in findings):
                findings.append("Логи: проверены (journalctl)")

    # Из логов извлекаем возможные находки/проблемы по ключевым фразам
    if "Error" in logs or "error" in logs or "FAILED" in logs:
        for line in logs.split("\n"):
            line = line.strip()
            if line and ("error" in line.lower() or "failed" in line.lower()) and line not in problems:
                if len(line) < 300:
                    problems.append(line)

    summary = "Успешно завершено" if run_obj.status == "succeeded" else "Завершено с ошибкой"
    if run_obj.finished_at:
        finished_at = run_obj.finished_at.isoformat()
    else:
        finished_at = timezone.now().isoformat()

    return {
        "workflow_run_id": run_obj.id,
        "workflow_name": (run_obj.workflow.name if run_obj.workflow_id else "") or "",
        "status": run_obj.status,
        "finished_at": finished_at,
        "summary": summary,
        "steps": steps,
        "findings": findings,
        "problems": problems[:20],
    }
