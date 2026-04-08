from bs4 import BeautifulSoup
import glob
files = glob.glob('core_ui/templates/mobile/*.html') + glob.glob('tasks/templates/tasks/mobile/*.html') + ['tasks/templates/tasks/task_card.html']
for f in files:
  html=open(f).read()
  BeautifulSoup(html, 'html.parser')
print('HTML OK')