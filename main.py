from nicegui import ui
import app.ui.orchestrator_panel
import os

if __name__ in {"__main__", "__mp_main__"}:
    # Initialize and run the NiceGUI application
    # The pages are registered via the imports
    port = int(os.getenv('NICEGUI_PORT', '8000'))
    ui.run(title='WEU AI Agent', dark=True, show=True, port=port, reload=True)
