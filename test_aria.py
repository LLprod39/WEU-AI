import os
import re

count = 0
for root, _, files in os.walk('.'):
    for file in files:
        if file.endswith('.html'):
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()

            # Find buttons that contain ONLY an icon (no text)
            # Example: <button class="btn"><span class="material-icons-round">add</span></button>
            # OR <button class="btn"><span class="icon">add</span></button>

            # Simple heuristic: find <button ...> <span class="...">icon</span> </button>
            # where there is no aria-label on the button

            # Let's write a simple regex for icon-only buttons missing aria-label
            pattern = re.compile(r'<button\b(?![^>]*\baria-label\b)[^>]*>\s*<span\b[^>]*class="[^"]*(material-icons|icon)[^"]*"[^>]*>[^<]*</span\s*>\s*</button>', re.IGNORECASE)
            matches = pattern.finditer(content)
            for m in matches:
                print(f"{path}: {m.group(0)}")
                count += 1

print(f"Total: {count}")
