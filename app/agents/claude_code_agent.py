"""
Claude Code CLI Agent - wrapper for Claude Code CLI
"""
from typing import Dict, Any, Optional
from loguru import logger
from app.agents.base_agent import BaseAgent
from app.core.model_config import model_manager


class ClaudeCodeAgent(BaseAgent):
    """
    Claude Code CLI Agent - для глубоких DevOps операций
    
    Использует Claude Code CLI от Anthropic для:
    - Глубоких рефакторингов с dependency awareness
    - Системного анализа инфраструктуры
    - Multi-file координированных изменений
    - Работы с большими конфигурациями (200K context)
    
    Особенности:
    - Стабильный 200K контекст
    - Autonomous multi-file operations
    - Architectural reasoning
    - Built-in MCP support
    """
    
    def __init__(self):
        super().__init__(
            name="Claude Code Agent",
            description="Deep DevOps operations with Claude Code CLI. 200K context, autonomous multi-file coordination, architectural analysis."
        )
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Execute task using Claude Code CLI
        
        Context parameters:
            - model: str - claude-4.5-opus/sonnet/haiku (default: sonnet)
            - workspace: str - рабочая директория
            - additional_dirs: List[str] - дополнительные директории для контекста
            - allowed_tools: List[str] - разрешённые инструменты
            - custom_agent: str - кастомный агент (если создан через UI)
            - continue_session: bool - продолжить предыдущую сессию
        """
        context = self.validate_context(context)
        
        try:
            from app.agents.cli_runtime import CliRuntimeManager
            
            manager = CliRuntimeManager()
            
            # Параметры для Claude Code CLI
            claude_model = context.get('model', 'claude-4.5-sonnet')
            workspace = context.get('workspace', '.')
            additional_dirs = context.get('additional_dirs', [])
            allowed_tools = context.get('allowed_tools', [])
            custom_agent = context.get('custom_agent')
            continue_session = context.get('continue_session', False)
            
            # Build config
            config = {}
            
            # Workspace and additional directories
            if workspace:
                config['workspace'] = workspace
            
            if additional_dirs:
                config['add-dir'] = ','.join(additional_dirs)
            
            # Allowed tools (автоматическое одобрение)
            if allowed_tools:
                config['allowedTools'] = ','.join(allowed_tools)
            
            # Custom agent
            if custom_agent:
                config['agent'] = custom_agent
            
            # Continue session
            if continue_session:
                config['continue'] = True
            
            logger.info(f"Claude Code CLI: model={claude_model}, workspace={workspace}")
            
            # Execute via CLI Runtime Manager
            result = await manager.run(
                runtime="claude",
                task=task,
                config=config
            )
            
            if result['success']:
                return {
                    'success': True,
                    'result': result['output'],
                    'error': None,
                    'metadata': {
                        'agent_type': 'claude_code',
                        'model': claude_model,
                        'runtime': 'claude_cli',
                        'context_tokens': '200K',
                        'exit_code': result.get('meta', {}).get('exit_code', 0)
                    }
                }
            else:
                return {
                    'success': False,
                    'result': None,
                    'error': result.get('logs', 'Unknown error'),
                    'metadata': {
                        'agent_type': 'claude_code',
                        'runtime': 'claude_cli',
                        'exit_code': result.get('meta', {}).get('exit_code', -1)
                    }
                }
        
        except FileNotFoundError as e:
            error_msg = f"Claude CLI not found. Install: curl -fsSL https://claude.ai/install.sh | bash"
            logger.error(f"Claude Code CLI execution failed: {e}")
            return {
                'success': False,
                'result': None,
                'error': error_msg,
                'metadata': {'agent_type': 'claude_code'}
            }
        
        except Exception as e:
            logger.error(f"Claude Code CLI execution failed: {e}")
            return {
                'success': False,
                'result': None,
                'error': str(e),
                'metadata': {'agent_type': 'claude_code'}
            }
