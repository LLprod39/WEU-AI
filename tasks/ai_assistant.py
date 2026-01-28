"""
AI Assistant for Task Management
Analyzes tasks, provides recommendations, and generates reports
"""
from typing import Dict, List, Any, Optional
from loguru import logger
from app.core.llm import LLMProvider
from app.core.model_config import model_manager
from app.agents.manager import get_agent_manager
from asgiref.sync import async_to_sync


class TaskAIAssistant:
    """AI assistant for analyzing and managing tasks"""
    
    def __init__(self):
        self.llm = LLMProvider()
        self.agent_manager = get_agent_manager()
    
    async def analyze_task(
        self,
        task_title: str,
        task_description: str,
        servers_context: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Анализ задачи: может ли ИИ выполнить её сам (есть нужный сервер и тип операции допустим).
        Ответ только на русском, JSON с полями can_delegate_to_ai, reason, recommended_agent и т.д.
        """
        try:
            import json
            import re
            model = model_manager.config.default_provider

            servers_text = ""
            servers_list = ""
            if servers_context:
                parts = [
                    f"- {s.get('name', '')} (хост: {s.get('host', '')}, порт: {s.get('port', 22)})"
                    for s in servers_context
                ]
                servers_list = "\n".join(parts)
                servers_text = f"Доступные серверы пользователя:\n{servers_list}"
            else:
                servers_text = "Список доступных серверов пуст — пользователь не добавил серверы."

            prompt = f"""Ты ИИ-помощник, который анализирует задачи пользователя и решает, может ли взять их на себя.

ЗАДАЧА: {task_title}
ОПИСАНИЕ: {task_description}

{servers_text}

ТВОИ ВОЗМОЖНОСТИ:
- Подключение к серверам по SSH и выполнение команд
- Установка пакетов (apt, yum, pip)
- Проверка статуса сервисов, логов, места на диске
- Настройка конфигураций, редактирование файлов
- Запуск скриптов и сервисов

ОГРАНИЧЕНИЯ (нужно явное подтверждение пользователя):
- Удаление критичных данных (rm -rf /, DROP DATABASE)
- Отключение production-сервисов
- Изменение паролей и ключей доступа

ИНСТРУКЦИИ:
1. Определи, упоминается ли в задаче конкретный сервер из списка доступных
2. Если сервер не указан явно — попробуй понять из контекста (например, "на проде" может означать production сервер)
3. Оцени, можешь ли ты выполнить эту задачу с имеющимися возможностями
4. Если не можешь — объясни почему (нет нужного сервера, опасная операция, нужны данные от пользователя и т.д.)

Верни строго JSON:
{{
    "can_delegate_to_ai": true или false,
    "target_server_name": "имя сервера из списка или null если не определён",
    "reason": "подробное обоснование на русском — почему можешь или не можешь выполнить",
    "missing_info": "что нужно уточнить у пользователя (или null)",
    "recommended_agent": "react|simple|complex|ralph",
    "estimated_time": "оценка времени на русском",
    "complexity": "simple|medium|complex",
    "risks": "потенциальные риски операции (или null)"
}}

Ответ (только JSON):"""

            response_text = ""
            async for chunk in self.llm.stream_chat(prompt, model=model):
                response_text += chunk

            json_match = re.search(r'\{[^{}]*\}', response_text, re.DOTALL)
            if not json_match:
                json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if json_match:
                try:
                    analysis = json.loads(json_match.group())
                    if not isinstance(analysis.get('can_delegate_to_ai'), bool):
                        analysis['can_delegate_to_ai'] = False
                    return {
                        'success': True,
                        'analysis': analysis,
                        'raw_response': response_text
                    }
                except json.JSONDecodeError:
                    logger.debug("Failed to parse JSON analysis response.")

            return {
                'success': True,
                'analysis': {
                    'can_delegate_to_ai': False,
                    'reason': 'Не удалось разобрать ответ ИИ.',
                    'recommended_agent': 'react',
                    'estimated_time': '',
                    'complexity': 'medium',
                    'raw_analysis': response_text
                },
                'raw_response': response_text
            }

        except Exception as e:
            logger.error(f"Task analysis failed: {e}")
            return {
                'success': False,
                'error': str(e),
                'analysis': None
            }
    
    async def improve_description(self, task_title: str, task_description: str) -> str:
        """Improve task description to be more clear and actionable"""
        try:
            model = model_manager.config.default_provider
            
            prompt = f"""You are a professional project manager. Improve the following task description to be more clear, actionable, and professional.

Task Title: {task_title}
Current Description: {task_description}

Return only the improved description as plain text. Do not add any conversational filler."""
            
            response_text = ""
            async for chunk in self.llm.stream_chat(prompt, model=model):
                response_text += chunk
            
            return response_text.strip()
            
        except Exception as e:
            logger.error(f"Description improvement failed: {e}")
            return task_description
    
    async def breakdown_task(self, task_title: str, task_description: str) -> List[str]:
        """Break down a complex task into smaller subtasks"""
        try:
            model = model_manager.config.default_provider
            
            prompt = f"""You are a professional project manager. Break down the following task into smaller, actionable subtasks.

Task Title: {task_title}
Description: {task_description}

Return the subtasks as a JSON list of strings. Example: ["Subtask 1", "Subtask 2"]
Do not add markdown formatting or any other text."""
            
            response_text = ""
            async for chunk in self.llm.stream_chat(prompt, model=model):
                response_text += chunk
            
            # Parse JSON
            import json
            import re
            
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0].strip()
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0].strip()
            
            json_match = re.search(r'\[.*?\]', response_text, re.DOTALL)
            if json_match:
                try:
                    subtasks = json.loads(json_match.group())
                    if isinstance(subtasks, list):
                        return subtasks
                except:
                    logger.debug("Failed to parse JSON subtasks response.")
            
            # Fallback: split by lines
            lines = [line.strip() for line in response_text.split('\n') if line.strip()]
            subtasks = []
            for line in lines:
                line = re.sub(r'^\d+[\.\)]\s*', '', line)
                if line and len(line) > 5:
                    subtasks.append(line)
            
            return subtasks if subtasks else []
            
        except Exception as e:
            logger.error(f"Task breakdown failed: {e}")
            return []
    
    async def generate_progress_report(self, tasks: List[Dict]) -> str:
        """Generate a progress report for a list of tasks"""
        try:
            model = model_manager.config.default_provider
            
            # Format tasks summary
            tasks_summary = "\n".join([
                f"- {t.get('title', 'Untitled')}: {t.get('status', 'Unknown')}"
                for t in tasks
            ])
            
            prompt = f"""Generate a professional progress report for the following tasks:

Tasks:
{tasks_summary}

Provide a comprehensive report including:
1. Overall progress summary
2. Completed tasks
3. In-progress tasks
4. Blocked or issues
5. Recommendations

Format as a clear, professional report."""
            
            response_text = ""
            async for chunk in self.llm.stream_chat(prompt, model=model):
                response_text += chunk
            
            return response_text.strip()
            
        except Exception as e:
            logger.error(f"Report generation failed: {e}")
            return "Error generating report"


# Sync wrappers for Django views
def analyze_task_sync(
    task_title: str,
    task_description: str,
    servers_context: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Synchronous wrapper for analyze_task"""
    assistant = TaskAIAssistant()
    return async_to_sync(assistant.analyze_task)(task_title, task_description, servers_context)


def improve_description_sync(task_title: str, task_description: str) -> str:
    """Synchronous wrapper for improve_description"""
    assistant = TaskAIAssistant()
    return async_to_sync(assistant.improve_description)(task_title, task_description)


def breakdown_task_sync(task_title: str, task_description: str) -> List[str]:
    """Synchronous wrapper for breakdown_task"""
    assistant = TaskAIAssistant()
    return async_to_sync(assistant.breakdown_task)(task_title, task_description)
