import re
import sys

files_to_check = [
    "core_ui/templates/mobile_app.html",
    "core_ui/templates/mobile/chat.html",
    "core_ui/templates/mobile/base.html",
    "core_ui/templates/mobile/knowledge_base.html"
]

def clean_text(html):
    return re.sub(r'<[^>]+>', '', html).strip()

all_good = True

for file in files_to_check:
    print(f"\nVerifying: {file}")
    with open(file, 'r') as f:
        content = f.read()

    for match in re.finditer(r'<button[^>]*>.*?</button>', content, re.DOTALL | re.IGNORECASE):
        full_html = match.group(0)

        # Checking specifically icon-only buttons
        text = clean_text(full_html)
        has_cyrillic = bool(re.search(r'[А-Яа-я]', text))
        words = text.split()

        # If the button is effectively icon-only
        if 'material-icons' in full_html and (len(words) <= 1 and not has_cyrillic):
            # There might be whitespace / line breaks, so we allow len(words) <= 1
            if 'aria-label' not in full_html:
                print(f"FAILED: Missing aria-label in {file}")
                print(full_html.strip())
                all_good = False
            elif 'aria-hidden="true"' not in full_html:
                print(f"FAILED: Missing aria-hidden in {file}")
                print(full_html.strip())
                all_good = False

if all_good:
    print("\nSUCCESS: All icon-only buttons in mobile templates have aria-label and aria-hidden attributes.")
    sys.exit(0)
else:
    print("\nFAILURE: Some icon-only buttons are still missing attributes.")
    sys.exit(1)
