import re

html_files = [
    "core_ui/templates/settings_access.html",
    "core_ui/templates/settings_groups.html",
    "core_ui/templates/settings_permissions.html",
    "core_ui/templates/settings_users.html",
    "core_ui/templates/settings.html",
]

for file in html_files:
    with open(file, "r") as f:
        content = f.read()
        buttons = re.findall(r'<button[^>]*>.*?</button>', content, re.DOTALL)
        for b in buttons:
            if 'aria-label' not in b and 'material-icons-round' in b:
                # Check if there is only icon in the button or icon + text
                text_content = re.sub(r'<[^>]*>', '', b).strip()
                # print(f"File: {file} - Button: {b} - Text: {text_content}")
                if text_content == 'close' or text_content == 'edit' or text_content == 'delete' or text_content == 'key':
                    print(f"Icon-only button missing aria-label in {file}: {b.strip()}")
