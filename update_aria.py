import re

file_path = "core_ui/templates/mobile/chat.html"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. history btn
content = re.sub(
    r'<button type="button" id="mobile-chat-history-btn" class="mobile-header-btn">\s*<span class="material-icons-round">history</span>\s*</button>',
    '<button type="button" id="mobile-chat-history-btn" class="mobile-header-btn" aria-label="История чатов">\n    <span class="material-icons-round" aria-hidden="true">history</span>\n</button>',
    content
)

# 2. new btn
content = re.sub(
    r'<button type="button" id="mobile-chat-new-btn" class="mobile-header-btn">\s*<span class="material-icons-round">add</span>\s*</button>',
    '<button type="button" id="mobile-chat-new-btn" class="mobile-header-btn" aria-label="Новый чат">\n    <span class="material-icons-round" aria-hidden="true">add</span>\n</button>',
    content
)

# 3. close drawer btn
content = re.sub(
    r'<button type="button" class="mobile-drawer-close" id="mobile-chat-history-close">\s*<span class="material-icons-round">close</span>\s*</button>',
    '<button type="button" class="mobile-drawer-close" id="mobile-chat-history-close" aria-label="Закрыть историю">\n                    <span class="material-icons-round" aria-hidden="true">close</span>\n                </button>',
    content
)

# 4. RAG toggle btn
content = re.sub(
    r'<button type="button" class="mobile-chat-option-btn" id="mobile-rag-toggle" title="RAG">\s*<span class="material-icons-round">storage</span>\s*</button>',
    '<button type="button" class="mobile-chat-option-btn" id="mobile-rag-toggle" title="RAG" aria-label="Переключить RAG">\n                <span class="material-icons-round" aria-hidden="true">storage</span>\n            </button>',
    content
)

# 5. Send btn
content = re.sub(
    r'<button type="button" id="mobile-chat-send" class="mobile-chat-send-btn" disabled>\s*<span class="material-icons-round">send</span>\s*</button>',
    '<button type="button" id="mobile-chat-send" class="mobile-chat-send-btn" aria-label="Отправить сообщение" disabled>\n                <span class="material-icons-round" aria-hidden="true">send</span>\n            </button>',
    content
)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)
