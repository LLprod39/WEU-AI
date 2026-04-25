from bs4 import BeautifulSoup
import sys

def verify_button(soup, button_id, expected_aria_label, expect_aria_hidden=True):
    button = soup.find('button', id=button_id)
    if not button:
        print(f"Error: Button with id '{button_id}' not found.")
        return False

    aria_label = button.get('aria-label')
    if aria_label != expected_aria_label:
        print(f"Error: Button '{button_id}' has aria-label '{aria_label}', expected '{expected_aria_label}'")
        return False

    span = button.find('span', class_='material-icons-round')
    if not span:
        print(f"Error: Button '{button_id}' missing inner span with class 'material-icons-round'")
        return False

    if expect_aria_hidden:
        aria_hidden = span.get('aria-hidden')
        if aria_hidden != 'true':
            print(f"Error: Button '{button_id}' inner span has aria-hidden '{aria_hidden}', expected 'true'")
            return False

    print(f"Success: Button '{button_id}' verified.")
    return True

def main():
    with open('core_ui/templates/mobile/chat.html', 'r', encoding='utf-8') as f:
        html = f.read()

    # Using html.parser to handle django template tags minimally
    soup = BeautifulSoup(html, 'html.parser')

    success = True
    success &= verify_button(soup, 'mobile-chat-history-btn', 'История чатов')
    success &= verify_button(soup, 'mobile-chat-new-btn', 'Новый чат')
    success &= verify_button(soup, 'mobile-chat-history-close', 'Закрыть')
    success &= verify_button(soup, 'mobile-rag-toggle', 'Переключить RAG')
    success &= verify_button(soup, 'mobile-chat-send', 'Отправить')

    if success:
        print("All buttons verified successfully!")
        sys.exit(0)
    else:
        print("Verification failed.")
        sys.exit(1)

if __name__ == '__main__':
    main()
