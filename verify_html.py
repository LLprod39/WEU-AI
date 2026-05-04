from bs4 import BeautifulSoup

with open("./skills/templates/skills/hub.html", "r", encoding="utf-8") as f:
    soup = BeautifulSoup(f.read(), "html.parser")

btn_send = soup.find("button", id="btn-gen-send")
btn_edit = soup.find("button", id="btn-gen-edit")
btn_copy = soup.find("button", id="btn-gen-copy")

print("btn-gen-send aria-label:", btn_send.get("aria-label"))
print("btn-gen-edit aria-label:", btn_edit.get("aria-label"))
print("btn-gen-copy aria-label:", btn_copy.get("aria-label"))
