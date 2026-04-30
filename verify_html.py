from bs4 import BeautifulSoup
import sys

def verify_file(filepath, selectors):
    print(f"Verifying {filepath}...")
    with open(filepath, 'r', encoding='utf-8') as f:
        html = f.read()

    soup = BeautifulSoup(html, 'html.parser')
    success = True
    for selector, check_fn in selectors.items():
        els = soup.select(selector)
        if not els:
            print(f"❌ Could not find element matching: {selector}")
            success = False
            continue
        for el in els:
            if not check_fn(el):
                print(f"❌ Element {selector} failed check. HTML: {el}")
                success = False
            else:
                print(f"✅ Element {selector} passed check.")
    return success

all_good = True

# Verify mobile_app.html
mobile_app_checks = {
    'button#notifBtn': lambda el: el.get('aria-label') == 'Уведомления',
    'button#notifBtn span.material-icons-round': lambda el: el.get('aria-hidden') == 'true',
    'button#refreshBtn': lambda el: el.get('aria-label') == 'Обновить',
    'button#refreshBtn span#refreshIcon': lambda el: el.get('aria-hidden') == 'true'
}
if not verify_file('core_ui/templates/mobile_app.html', mobile_app_checks):
    all_good = False

# Verify knowledge_base.html
kb_checks = {
    'button#kb-search-btn span.material-icons-round': lambda el: el.get('aria-hidden') == 'true'
}
if not verify_file('core_ui/templates/knowledge_base.html', kb_checks):
    all_good = False

if all_good:
    print("\n🎉 All checks passed!")
    sys.exit(0)
else:
    print("\n💥 Some checks failed.")
    sys.exit(1)
