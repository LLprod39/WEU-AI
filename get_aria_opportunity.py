import os
import re

path = 'agent_hub/templates/agent_hub/mobile/agents.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

pattern = re.compile(r'<button([^>]*?)>\s*<span([^>]*class="[^"]*(?:material-icons|icon)[^"]*"[^>]*)>([^<]+)</span>\s*</button>', re.IGNORECASE)

def replacer(match):
    button_attrs = match.group(1)
    span_attrs = match.group(2)
    icon_name = match.group(3).strip()

    # Check if aria-label is actually there
    if 'aria-label=' in button_attrs:
        return match.group(0)

    # Extract title if present
    title_match = re.search(r'title="([^"]+)"', button_attrs)
    aria_label = title_match.group(1) if title_match else f"{icon_name.replace('_', ' ').capitalize()}"

    print(f"Adding aria-label='{aria_label}' to icon-only button: <button{button_attrs}><span{span_attrs}>{icon_name}</span></button>")

    # Check if aria-hidden is in span
    if 'aria-hidden="true"' not in span_attrs:
        span_attrs += ' aria-hidden="true"'

    new_button = f'<button{button_attrs} aria-label="{aria_label}">\n    <span{span_attrs}>{icon_name}</span>\n</button>'
    return new_button

new_content = pattern.sub(replacer, content)
