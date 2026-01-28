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
            if servers_context:
                parts = [
                    f"{s.get('name', '')} ({s.get('host', '')}:{s.get('port', 22)})"
                    for s in servers_context
                ]
                servers_text = "Доступные серверы пользователя (имя, хост:порт): " + ", ".join(parts)
            else:
                servers_text = "Список доступных серверов не передан."

            prompt = f"""Ты анализируешь задачу пользователя. Ответь только на русском в формате JSON.

Задача: {task_title}
Описание: {task_description}
{servers_text}

Определи, может ли ИИ реально выполнить эту задачу сам: есть ли подходящий сервер в списке и является ли операция допустимой (проверка места на диске, чтение логов, проверка сервисов и т.п.). Удаление файлов, перезапись критичных путей, отключение сервисов — без явного подтверждения не считаются допустимыми.

Верни строго один JSON-объект с полями:
{{
    "can_delegate_to_ai": true или false,
    "reason": "краткое обоснование на русском",
    "recommended_agent": "react|simple|complex|ralph",
    "estimated_time": "оценка в часах или минутах на русском",
    "complexity": "simple|medium|complex"
}}

Ответ (только JSON, без markdown и пояснений):"""

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
