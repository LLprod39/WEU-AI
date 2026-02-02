#!/usr/bin/env python3
"""Автономная проверка места на диске (без Django): корень ФС и каталоги."""
import shutil
from pathlib import Path


def human_size(n):
    for u in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {u}"
        n /= 1024
    return f"{n:.1f} PB"


def get_disk_usage(path):
    try:
        p = Path(path).resolve()
        if p.is_file():
            p = p.parent
        if not p.exists():
            return {"path": str(path), "error": "path does not exist"}
        total, used, free = shutil.disk_usage(str(p))
        pct = round(100.0 * used / total, 1) if total else None
        return {
            "path": str(p),
            "total": total,
            "used": used,
            "free": free,
            "percent_used": pct,
            "total_human": human_size(total),
            "used_human": human_size(used),
            "free_human": human_size(free),
        }
    except Exception as e:
        return {"path": str(path), "error": f"{type(e).__name__}: {e}"}


def main():
    paths = [Path("/")]
    # Доп. каталоги на сервере (если есть)
    for p in ["/home/lunix", "/home/lunix/keep", "/tmp", "/var"]:
        if Path(p).exists():
            paths.append(Path(p))
    report = []
    seen = set()
    for p in paths:
        key = str(Path(p).resolve())
        if key in seen:
            continue
        seen.add(key)
        report.append(get_disk_usage(p))
    for item in report:
        if "error" in item:
            print(f"path={item['path']} error={item['error']}")
        else:
            print(
                f"path={item['path']} total={item['total']} used={item['used']} free={item['free']} "
                f"percent_used={item['percent_used']} total_human={item['total_human']} "
                f"used_human={item['used_human']} free_human={item['free_human']}"
            )
    print("---")
    print("STEP_DONE")


if __name__ == "__main__":
    main()
