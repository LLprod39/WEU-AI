import re

files_to_check = [
    "core_ui/templates/mobile_app.html",
    "core_ui/templates/mobile/chat.html",
    "core_ui/templates/mobile/base.html",
    "core_ui/templates/mobile/knowledge_base.html"
]

def analyze_buttons(filepath):
    print(f"\n--- Analyzing {filepath} ---")
    try:
        with open(filepath, 'r') as f:
            content = f.read()
    except FileNotFoundError:
        print(f"File not found: {filepath}")
        return

    button_pattern = re.compile(r'<button\b([^>]*)>(.*?)</button>', re.DOTALL | re.IGNORECASE)

    for i, match in enumerate(button_pattern.finditer(content)):
        attrs = match.group(1)
        inner = match.group(2)

        # Strip comments
        inner_no_comments = re.sub(r'<!--.*?-->', '', inner, flags=re.DOTALL)

        # Check if text exists after removing tags and whitespace
        inner_text = re.sub(r'<[^>]+>', '', inner_no_comments).strip()
        has_text = bool(inner_text)

        # Check if it contains an icon
        has_icon = 'material-icons' in inner_no_comments

        if not has_text and has_icon:
            if 'aria-label' not in attrs:
                print(f"Button {i+1}: MISSING aria-label")
                print(f"  Attrs: {attrs.strip()}")
                print(f"  Inner: {inner.strip()}")
                if 'aria-hidden="true"' not in inner:
                    print(f"  --> ALSO MISSING aria-hidden='true' on inner element")
                print("-" * 40)

for file in files_to_check:
    analyze_buttons(file)
