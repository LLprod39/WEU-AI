#!/usr/bin/env python3
"""
Извлекает страницы PDF как PNG для README (presentation-01.png ... presentation-12.png).
Требует: pip install pymupdf
"""
import sys
from pathlib import Path

# Добавляем корень проекта в path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

PDF_PATH = ROOT / "docs" / "images" / "WEU_AI_Agent_Platform_DevOps_Edition.pdf"
OUT_DIR = ROOT / "docs" / "images"


def main():
    try:
        import fitz  # PyMuPDF
    except ImportError:
        print("Установите PyMuPDF: pip install pymupdf")
        sys.exit(1)

    if not PDF_PATH.exists():
        print(f"PDF не найден: {PDF_PATH}")
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(PDF_PATH)
    total = min(12, len(doc))  # максимум 12 слайдов

    for i in range(total):
        page = doc[i]
        # zoom для приемлемого разрешения (2 = 144 DPI примерно)
        mat = fitz.Matrix(2, 2)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        out_name = OUT_DIR / f"presentation-{i + 1:02d}.png"
        pix.save(str(out_name))
        print(f"  {out_name.name}")

    doc.close()
    print(f"Готово: {total} слайдов в {OUT_DIR}")


if __name__ == "__main__":
    main()
