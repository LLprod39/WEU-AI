import re

files_to_check = [
    "core_ui/templates/mobile_app.html",
    "core_ui/templates/mobile/chat.html",
    "core_ui/templates/mobile/base.html",
    "core_ui/templates/mobile/knowledge_base.html"
]

def clean_text(html):
    return re.sub(r'<[^>]+>', '', html).strip()

for file in files_to_check:
    print(f"\nAnalyzing: {file}")
    with open(file, 'r') as f:
        content = f.read()

    for match in re.finditer(r'<button[^>]*>.*?</button>', content, re.DOTALL | re.IGNORECASE):
        full_html = match.group(0)
        if 'material-icons' in full_html and 'aria-label' not in full_html:
            text = clean_text(full_html)
            has_cyrillic = bool(re.search(r'[А-Яа-я]', text))
            words = text.split()

            if len(words) == 1 and not has_cyrillic:
                print(full_html.strip())
                print('-'*40)
