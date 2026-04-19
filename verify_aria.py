from bs4 import BeautifulSoup
with open('tasks/templates/tasks/task_list.html', 'r') as f:
    soup = BeautifulSoup(f.read(), 'html.parser')

toggle_btn = soup.find('button', class_='toggle-sidebar-btn')
assert toggle_btn and toggle_btn.get('aria-label') == 'Toggle sidebar'
assert toggle_btn.find('span').get('aria-hidden') == 'true'

modal_close_btns = soup.find_all('button', class_='modal-close')
assert len(modal_close_btns) == 7
for btn in modal_close_btns:
    assert btn.get('aria-label') is not None
    assert btn.find('span').get('aria-hidden') == 'true'
print('Verification successful!')
