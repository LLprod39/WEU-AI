from playwright.sync_api import sync_playwright
import time
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:9000/login/")
    page.get_by_placeholder("Enter your username").fill("admin")
    page.get_by_placeholder("Enter your password").fill("admin")
    page.get_by_role("button", name="Sign In").click()
    page.wait_for_timeout(2000)
    page.goto("http://localhost:9000/settings/access/")
    page.wait_for_timeout(2000)
    page.screenshot(path="frontend_screenshot.png")
    browser.close()
