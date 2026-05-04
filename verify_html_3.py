from bs4 import BeautifulSoup
with open("./skills/templates/skills/hub.html", "r", encoding="utf-8") as f:
    soup = BeautifulSoup(f.read(), "html.parser")
btn_send = soup.find("button", id="btn-gen-send")
btn_edit = soup.find("button", id="btn-gen-edit")
btn_copy = soup.find("button", id="btn-gen-copy")
assert btn_send.get("aria-label") == "Отправить"
assert btn_edit.get("aria-label") == "Редактировать"
assert btn_copy.get("aria-label") == "Копировать"
assert btn_send.find("span").get("aria-hidden") == "true"
assert btn_edit.find("span").get("aria-hidden") == "true"
assert btn_copy.find("span").get("aria-hidden") == "true"
print("Verification passed!")
