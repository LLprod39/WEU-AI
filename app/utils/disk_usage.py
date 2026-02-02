"""
Утилита проверки свободного/занятого места по путям (корень, MEDIA_ROOT, каталоги приложения).
Использует shutil.disk_usage (на Unix — statvfs). Обработка ошибок доступа и отсутствия пути.
"""
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional


def get_disk_usage(path: str | Path) -> Dict[str, Any]:
    """
    Возвращает статистику диска для заданного пути.

    На Unix использует statvfs через shutil.disk_usage; путь приводится к абсолютному,
    для каталогов проверяется место на той же файловой системе (mount point).

    Args:
        path: путь к файлу или каталогу (строка или Path).

    Returns:
        Словарь:
        - path: нормализованный путь (строка)
        - total: всего байт
        - used: занято байт
        - free: свободно байт
        - percent_used: доля занятого 0..100 (или None при ошибке)
        - error: сообщение об ошибке (если была), иначе отсутствует
    """
    result: Dict[str, Any] = {
        "path": "",
        "total": None,
        "used": None,
        "free": None,
        "percent_used": None,
    }
    try:
        p = Path(path).resolve()
        result["path"] = str(p)
        # Для каталога shutil.disk_usage даёт статистику по той ФС, где лежит каталог
        if p.is_file():
            p = p.parent
        if not p.exists():
            result["error"] = "path does not exist"
            return result
        total, used, free = shutil.disk_usage(str(p))
        result["total"] = total
        result["used"] = used
        result["free"] = free
        result["percent_used"] = round(100.0 * used / total, 1) if total else None
    except (FileNotFoundError, PermissionError, OSError) as e:
        result["path"] = str(path)
        result["error"] = f"{type(e).__name__}: {e}"
    except Exception as e:
        result["path"] = str(path)
        result["error"] = f"{type(e).__name__}: {e}"
    return result


def get_disk_usage_report(
    *,
    include_root: bool = True,
    media_root: Optional[Path] = None,
    uploaded_files_dir: Optional[Path] = None,
    agent_projects_dir: Optional[Path] = None,
    base_dir: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    """
    Формирует отчёт по диску для стандартных путей приложения.

    Args:
        include_root: добавлять ли корень ФС (/)
        media_root: путь MEDIA_ROOT
        uploaded_files_dir: путь UPLOADED_FILES_DIR (если совпадает с media — можно не передавать)
        agent_projects_dir: путь AGENT_PROJECTS_DIR
        base_dir: путь BASE_DIR (корень проекта)

    Returns:
        Список словарей, каждый — результат get_disk_usage для одного пути.
        Пути с None не добавляются. Порядок: root (если есть), base_dir, media_root,
        uploaded_files_dir (если передан и отличается от media), agent_projects_dir.
    """
    report: List[Dict[str, Any]] = []
    seen_paths: set = set()

    def add(path: Optional[Path], label_prefix: str = "") -> None:
        if path is None:
            return
        p = Path(path).resolve()
        key = str(p)
        if key in seen_paths:
            return
        seen_paths.add(key)
        entry = get_disk_usage(p)
        if label_prefix:
            entry["label"] = label_prefix
        report.append(entry)

    if include_root:
        add(Path("/"), "root")
    if base_dir is not None:
        add(base_dir, "base_dir")
    if media_root is not None:
        add(media_root, "media_root")
    if uploaded_files_dir is not None:
        add(uploaded_files_dir, "uploaded_files_dir")
    if agent_projects_dir is not None:
        add(agent_projects_dir, "agent_projects_dir")
    return report
