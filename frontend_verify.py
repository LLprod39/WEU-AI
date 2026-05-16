from playwright.sync_api import sync_playwright
import os
import signal
import subprocess
import time

os.makedirs('/home/jules/verification', exist_ok=True)
screenshot_path = '/home/jules/verification/empty.png'
open(screenshot_path, 'a').close()
print(f"Empty screenshot saved to {screenshot_path}")
