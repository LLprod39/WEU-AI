import re

files_to_check = [
    "core_ui/templates/mobile_app.html",
    "core_ui/templates/mobile/chat.html",
    "core_ui/templates/mobile/base.html",
    "core_ui/templates/mobile/knowledge_base.html"
]

for filepath in files_to_check:
    print(f"\n--- Analyzing {filepath} ---")
    try:
        with open(filepath, 'r') as f:
            content = f.read()
    except FileNotFoundError:
        print(f"File not found: {filepath}")
        continue

    button_pattern = re.compile(r'<button\b([^>]*)>(.*?)</button>', re.DOTALL | re.IGNORECASE)

    for i, match in enumerate(button_pattern.finditer(content)):
        attrs = match.group(1)
        inner = match.group(2)

        # If the button contains "material-icons" and doesn't have aria-label
        if 'material-icons' in inner and 'aria-label' not in attrs.lower():
            # Check if there is any readable text outside the icon span
            text_without_tags = re.sub(r'<[^>]+>', '', inner).strip()
            # If the text is very short or empty, it's likely an icon-only button
            if len(text_without_tags) < 3:
                print(f"Button {i+1}: MISSING aria-label")
                print(f"  Attrs: {attrs.strip()}")
                print(f"  Inner: {inner.strip()}")
                if 'aria-hidden="true"' not in inner.lower():
                    print(f"  --> ALSO MISSING aria-hidden='true'")
                print("-" * 40)
