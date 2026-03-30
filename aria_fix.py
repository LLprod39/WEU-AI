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

            # Icons like 'notifications', 'refresh', 'history', etc are just text inside the <span>,
            # but they act as icons, not text that the user sees as words.
            # We can detect this by looking if the text is ONE single word from material-icons set.
            # E.g., if there are no spaces or Cyrillic characters.

            has_cyrillic = bool(re.search(r'[А-Яа-я]', text))
            has_spaces_outside_icon = bool(re.search(r'\s{2,}', text))
            words = text.split()

            if len(words) == 1 and not has_cyrillic:
                print(">> ICON-ONLY BUTTON DETECTED")
                print(full_html.strip())
                print('-'*40)
