import asyncio
from nicegui import ui, app
from app.core.unified_orchestrator import UnifiedOrchestrator
import os

# Initialize UnifiedOrchestrator
orchestrator = UnifiedOrchestrator()

async def init_state():
    """Initialize the orchestrator on startup."""
    await orchestrator.initialize()

app.on_startup(init_state)

@ui.page('/')
async def main_page():
    """
    Main UI Entry Point.
    Wraps the UI code in a function to avoid global scope execution issues
    and enable proper support for interactive debugging.
    """
    # --- Theme & Styles - Современный легкий дизайн ---
    ui.colors(
        primary='#6366f1',    # Indigo (современный)
        secondary='#8b5cf6',  # Purple
        accent='#06b6d4',     # Cyan
        dark='#09090b',      # Современный темный фон
        positive='#22c55e',
        negative='#ef4444',
        info='#3b82f6',
        warning='#f59e0b'
    )
    
    # Custom CSS - Гибкая настройка через CSS переменные
    ui.add_head_html('''
        <style>
            :root {
                --bg-deep: #050507;
                --bg-base: #09090b;
                --bg-surface: #111113;
                --bg-elevated: #18181b;
                --border-subtle: rgba(255, 255, 255, 0.06);
                --border-default: rgba(255, 255, 255, 0.1);
                --primary: #6366f1;
                --primary-hover: #4f46e5;
                --text-primary: #fafafa;
                --text-secondary: #a1a1aa;
                --spacing-sm: 0.5rem;
                --spacing-md: 1rem;
                --spacing-lg: 1.5rem;
                --radius-sm: 0.5rem;
                --radius-md: 0.75rem;
                --radius-lg: 1rem;
                --transition-base: 0.2s ease;
                --blur-md: 20px;
                --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                --shadow-primary: 0 4px 15px rgba(99, 102, 241, 0.25);
            }
            
            body { 
                background-color: var(--bg-base); 
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                color: var(--text-primary);
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
            }
            
            .glass-panel {
                background: rgba(17, 17, 19, 0.7);
                backdrop-filter: blur(var(--blur-md));
                -webkit-backdrop-filter: blur(var(--blur-md));
                border: 1px solid var(--border-default);
                border-radius: var(--radius-lg);
                box-shadow: var(--shadow-md);
                transition: all var(--transition-base);
            }
            
            .glass-panel:hover {
                border-color: var(--border-default);
                box-shadow: var(--shadow-primary);
            }
            
            .chat-bubble-user {
                background: linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%);
                color: white;
                border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg);
                padding: var(--spacing-md);
                box-shadow: var(--shadow-primary);
                transition: all var(--transition-base);
            }
            
            .chat-bubble-user:hover {
                transform: translateY(-1px);
                box-shadow: 0 6px 20px rgba(99, 102, 241, 0.35);
            }
            
            .chat-bubble-ai {
                background: var(--bg-surface);
                color: var(--text-primary);
                border: 1px solid var(--border-subtle);
                border-radius: var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm);
                padding: var(--spacing-md);
                transition: all var(--transition-base);
            }
            
            .chat-bubble-ai:hover {
                border-color: var(--border-default);
                box-shadow: var(--shadow-md);
            }
            
            /* Улучшенная прокрутка */
            ::-webkit-scrollbar {
                width: 8px;
                height: 8px;
            }
            
            ::-webkit-scrollbar-track {
                background: transparent;
            }
            
            ::-webkit-scrollbar-thumb {
                background: rgba(113, 113, 122, 0.4);
                border-radius: 4px;
            }
            
            ::-webkit-scrollbar-thumb:hover {
                background: rgba(113, 113, 122, 0.6);
            }
            
            /* Плавные переходы */
            * {
                transition: background-color var(--transition-base), 
                            border-color var(--transition-base),
                            color var(--transition-base);
            }
        </style>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    ''')

    # --- UI Layout - Современный легкий дизайн ---
    with ui.column().classes('w-full h-screen p-0 m-0 no-wrap items-center').style('background: var(--bg-base); color: var(--text-primary);'):
        
        # Header - Улучшенный
        with ui.row().classes('w-full h-16 px-6 items-center justify-between glass-panel z-10'):
            ui.label('ORCHESTRATOR').classes('text-xl font-bold tracking-wider').style('color: var(--primary);')
            with ui.row().classes('gap-3'):
                ui.button(icon='settings', on_click=lambda: ui.notify('Настройки', type='info')).props('flat round').style('color: var(--text-secondary);')
                ui.button(icon='help', on_click=lambda: ui.notify('Помощь', type='info')).props('flat round').style('color: var(--text-secondary);')

        # Chat Container - Улучшенный
        chat_container = ui.column().classes('w-full max-w-4xl flex-grow overflow-y-auto p-6 gap-4')
        
        with chat_container:
            ui.label('Система онлайн. Готова к работе.').classes('text-center w-full py-4 text-sm').style('color: var(--text-secondary);')

        # Input Area - Современный дизайн
        with ui.column().classes('w-full max-w-4xl p-4 pb-6'):
            with ui.row().classes('w-full gap-2 items-end glass-panel rounded-xl p-3'):
                text_input = ui.textarea(placeholder='Введите вашу инструкцию...').props('rows=1 autogrow borderless').classes('flex-grow px-3 py-2').style('background: transparent; color: var(--text-primary); font-size: 14px;')
                
                async def send_message():
                    msg = text_input.value
                    if not msg: return
                    
                    text_input.value = ''
                    
                    with chat_container:
                        with ui.row().classes('w-full justify-end'):
                            ui.label(msg).classes('chat-bubble-user max-w-xl')
                        
                        spinner = ui.spinner('dots', size='lg', color='primary').classes('ml-4')
                    
                    # Process with Orchestrator
                    response_text = ""
                    try:
                        async for chunk in orchestrator.process_user_message(msg):
                            if chunk.startswith('\n\n🔧') or chunk.startswith('✅'):
                                # Tool usage logs
                                with chat_container:
                                    ui.label(chunk.strip()).classes('text-xs text-slate-400 ml-4')
                            else:
                                response_text += chunk
                    except Exception as e:
                        response_text = f"Error: {str(e)}"
                    
                    spinner.delete()
                    
                    with chat_container:
                        with ui.row().classes('w-full justify-start'):
                            ui.markdown(response_text).classes('chat-bubble-ai max-w-xl')
                            
                    chat_container.scroll_to(percent=1.0)

                ui.button(icon='send', on_click=send_message).props('round flat color=primary')

# Run only if executed directly
if __name__ in {"__main__", "__mp_main__"}:
    # reload=False is safer for some interactive environments to avoid the script mode error
    # but normally wrapped in function and if __name__ main is enough.
    ui.run(title='AI Orchestrator', dark=True, reload=True, show=True)
