import re

with open('tasks/templates/tasks/task_list.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace <button class="toggle-sidebar-btn" ...>
content = re.sub(
    r'<button class="toggle-sidebar-btn" onclick="toggleSidebar\(\)">\n                <span class="material-icons-round"([^>]*)>menu</span>\n            </button>',
    r'<button class="toggle-sidebar-btn" onclick="toggleSidebar()" aria-label="Toggle sidebar">\n                <span class="material-icons-round" aria-hidden="true"\1>menu</span>\n            </button>',
    content
)

# Replace <button class="modal-close" ...>
content = re.sub(
    r'<button class="modal-close" onclick="([^"]+)">\n                <span class="material-icons-round">close</span>\n            </button>',
    r'<button class="modal-close" onclick="\1" aria-label="Close modal">\n                <span class="material-icons-round" aria-hidden="true">close</span>\n            </button>',
    content
)

with open('tasks/templates/tasks/task_list.html', 'w', encoding='utf-8') as f:
    f.write(content)
