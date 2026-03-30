import re

files_to_check = [
    "core_ui/templates/mobile_app.html",
    "core_ui/templates/mobile/chat.html",
    "core_ui/templates/mobile/base.html",
    "core_ui/templates/mobile/knowledge_base.html"
]

def analyze_buttons(filepath):
    print(f"\n--- Analyzing {filepath} ---")
    with open(filepath, 'r') as f:
        content = f.read()

    # Simple regex to find <button> tags
    button_pattern = re.compile(r'<button\s([^>]*)>(.*?)</button>', re.DOTALL)
    for match in button_pattern.finditer(content):
        attrs = match.group(1)
        inner = match.group(2)

        # Check if it's icon-only
        has_text = bool(re.search(r'[a-zA-Zа-яА-Я]', re.sub(r'<[^>]+>', '', inner)))
        has_icon = 'material-icons' in inner

        if not has_text and has_icon:
            print(f"Potential icon-only button without aria-label:")
            print(f"Attrs: {attrs}")
            print(f"Inner: {inner.strip()}")
            if 'aria-label' not in attrs:
                print(">>> MISSING aria-label")
            if 'aria-hidden="true"' not in inner:
                print(">>> MISSING aria-hidden='true' on icon")
            print("-" * 40)

for file in files_to_check:
    analyze_buttons(file)
