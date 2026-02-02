# -*- coding: utf-8 -*-
with open('web_ui/settings.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Найти место для вставки (после claude config, перед закрывающей скобкой)
insert_marker = '    },\n    # NOTE: Ralph Wiggum is NOT a CLI tool'
if insert_marker in content:
    # Старый маркер есть - заменим
    ralph_config = '''    },
    \"ralph\": {
        \"command\": _cli_command(\"CLAUDE_CLI_PATH\", \"claude\"),
        # Ralph DevOps mode: ONLY SSH and console tools, NO file operations
        \"args\": [
            \"-p\", \"--verbose\", \"--output-format\", \"stream-json\",
            \"--include-partial-messages\", \"--dangerously-skip-permissions\",
            \"--debug\", \"mcp\", \"--sandbox\", \"enabled\",
        ],
        \"prompt_style\": \"positional\",
        \"allowed_args\": [
            \"model\",
            \"mcp-config\",
            \"allowedTools\",  # Set to: server_execute,servers_list,shell_execute
        ],
        \"timeout_seconds\": 1800,  # 30 minutes for DevOps tasks
    },
    # NOTE: Ralph Wiggum is NOT a CLI tool'''
    content = content.replace(insert_marker, ralph_config)
else:
    print('Маркер не найден, ищем другое место...')
    # Найти конец claude config
    marker2 = '        \"timeout_seconds\": 1800,  # 30 минут для глубоких операций\n    },'
    if marker2 in content:
        ralph_cfg = '''
    \"ralph\": {
        \"command\": _cli_command(\"CLAUDE_CLI_PATH\", \"claude\"),
        # Ralph DevOps mode: ONLY SSH and console tools, NO file operations
        \"args\": [
            \"-p\", \"--verbose\", \"--output-format\", \"stream-json\",
            \"--include-partial-messages\", \"--dangerously-skip-permissions\",
            \"--debug\", \"mcp\", \"--sandbox\", \"enabled\",
        ],
        \"prompt_style\": \"positional\",
        \"allowed_args\": [
            \"model\",
            \"mcp-config\",
            \"allowedTools\",  # Set to: server_execute,servers_list,shell_execute
        ],
        \"timeout_seconds\": 1800,  # 30 minutes for DevOps tasks
    },'''
        content = content.replace(marker2, marker2 + ralph_cfg)
    else:
        print('Не могу найти место для вставки!')
        import sys
        sys.exit(1)

with open('web_ui/settings.py', 'w', encoding='utf-8') as f:
    f.write(content)

print('✅ Ralph конфигурация добавлена')
