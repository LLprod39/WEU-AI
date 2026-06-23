import os
import re

count = 0
# Basic pattern for <button ...><span class="...">icon</span></button>
pattern = re.compile(r'<button([^>]*?)>\s*<span([^>]*class="[^"]*(?:material-icons|icon)[^"]*"[^>]*)>([^<]+)</span>\s*</button>', re.IGNORECASE)

for root, _, files in os.walk('.'):
    for file in files:
        if file.endswith('.html'):
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()

            def replacer(match):
                button_attrs = match.group(1)
                span_attrs = match.group(2)
                icon_name = match.group(3).strip()

                # Check if aria-label is actually there
                if 'aria-label=' in button_attrs:
                    return match.group(0)

                # Extract title if present
                title_match = re.search(r'title="([^"]+)"', button_attrs)
                aria_label = title_match.group(1) if title_match else f"{icon_name.replace('_', ' ').capitalize()}"

                # Check if aria-hidden is in span
                if 'aria-hidden="true"' not in span_attrs:
                    span_attrs += ' aria-hidden="true"'

                new_button = f'<button{button_attrs} aria-label="{aria_label}">\n    <span{span_attrs}>{icon_name}</span>\n</button>'
                return new_button

            new_content = pattern.sub(replacer, content)

            if new_content != content:
                print(f"Fixing {path}")
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                count += 1

print(f"Fixed {count} files")
