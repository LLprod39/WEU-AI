from bs4 import BeautifulSoup

with open("./skills/templates/skills/hub.html", "r", encoding="utf-8") as f:
    soup = BeautifulSoup(f.read(), "html.parser")

btn_send = soup.find("button", id="btn-gen-send")
btn_edit = soup.find("button", id="btn-gen-edit")
btn_copy = soup.find("button", id="btn-gen-copy")
span_send = btn_send.find("span") if btn_send else None
span_edit = btn_edit.find("span") if btn_edit else None
span_copy = btn_copy.find("span") if btn_copy else None

print("btn_send inner HTML:", btn_send.decode_contents() if btn_send else None)
print("btn_edit inner HTML:", btn_edit.decode_contents() if btn_edit else None)
print("btn_copy inner HTML:", btn_copy.decode_contents() if btn_copy else None)
print("span_send class:", span_send.get("class") if span_send else None)
