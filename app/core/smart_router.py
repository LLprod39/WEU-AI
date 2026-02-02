"""
Smart Task Router - автоматический выбор оптимального агента и runtime
"""
import asyncio
import re
import json
from typing import Dict, Any, Optional
from loguru import logger
from app.core.llm import LLMProvider
from app.core.model_config import model_manager
from app.core.provider_registry import get_provider_registry


class SmartTaskRouter:
    """
    Умный роутинг задач на оптимальный агент/runtime
    
    Анализирует задачу и рекомендует:
    - orchestrator_mode (react | ralph_internal | ralph_cli)
    - runtime (claude | cursor | ralph)
    - model (claude-4.5-opus, grok-3, etc)
    - agent_type (для использования с Agent Manager)
    
    Учитывает:
    - Сложность задачи
    - Размер конфигов/кода
    - Доступность провайдеров
    - DevOps специфику
    """
    
    def __init__(self):
        self.llm = LLMProvider()
        self.registry = get_provider_registry()
    
    async def route(self, task_title: str, task_description: str = "", context: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Анализ задачи и выбор оптимального routing
        
        Args:
            task_title: Заголовок задачи
            task_description: Описание задачи
            context: Дополнительный контекст (server, files_count, etc)
        
        Returns:
            Dict с рекомендациями:
                - orchestrator_mode: str
                - runtime: str
                - model: str
                - agent_type: str
                - reason: str
                - confidence: float (0-1)
        """
        context = context or {}
        
        try:
            # Быстрый анализ сложности
            analysis = await self._quick_analyze(task_title, task_description, context)
            
            # Получаем доступные провайдеры
            available_providers = self.registry.get_available_providers()
            available_ids = [p['id'] for p in available_providers]
            
            logger.info(f"Task analysis: {analysis}")
            logger.info(f"Available providers: {available_ids}")
            
            # Routing logic
            routing = self._decide_routing(analysis, available_ids, context)
            
            # Fallback если рекомендованный провайдер недоступен
            if routing['runtime'] not in available_ids:
                routing = self._fallback_routing(available_ids)
                routing['reason'] += " (fallback - preferred provider unavailable)"
            
            logger.success(f"Routing decision: {routing}")
            return routing
        
        except Exception as e:
            logger.error(f"Smart routing failed: {e}, using default")
            return self._default_routing()
    
    async def _quick_analyze(self, title: str, description: str, context: Dict) -> Dict[str, Any]:
        """
        Быстрый анализ задачи через Grok (дёшево и быстро)
        """
        try:
            prompt = f"""Analyze DevOps/IT task complexity:

Title: {title}
Description: {description[:500]}

Context:
- Files count: {context.get('files_count', 'unknown')}
- Config size: {context.get('config_size', 'unknown')}
- Server: {context.get('server_name', 'unknown')}

Return JSON ONLY (no markdown):
{{
    "requires_multi_file_coordination": bool,
    "config_files_size_kb": estimated int,
    "is_infrastructure_change": bool,
    "requires_deep_reasoning": bool,
    "is_quick_fix": bool,
    "estimated_time_minutes": int,
    "subtasks_count": estimated int,
    "complexity": "simple|medium|complex",
    "risk_level": "low|medium|high"
}}"""
            
            response_text = ""
            # Используем Grok для быстрого анализа (если доступен)
            if model_manager.config.grok_enabled:
                async for chunk in self.llm.stream_chat(prompt, model="grok"):
                    response_text += chunk
            else:
                # Fallback: упрощённая логика без LLM
                return self._simple_heuristic_analysis(title, description)
            
            # Парсинг JSON
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if json_match:
                analysis = json.loads(json_match.group())
                return analysis
            else:
                logger.warning("Failed to parse analysis JSON, using heuristics")
                return self._simple_heuristic_analysis(title, description)
        
        except Exception as e:
            logger.warning(f"Quick analyze failed: {e}, using heuristics")
            return self._simple_heuristic_analysis(title, description)
    
    def _simple_heuristic_analysis(self, title: str, description: str) -> Dict[str, Any]:
        """Простой эвристический анализ без LLM"""
        text = (title + " " + description).lower()
        
        # Ключевые слова для определения сложности
        complex_keywords = ['migrate', 'refactor', 'architecture', 'design', 'rebuild']
        quick_keywords = ['restart', 'check', 'status', 'test', 'verify']
        infrastructure_keywords = ['docker', 'kubernetes', 'nginx', 'postgres', 'ssl']
        
        is_complex = any(kw in text for kw in complex_keywords)
        is_quick = any(kw in text for kw in quick_keywords)
        is_infrastructure = any(kw in text for kw in infrastructure_keywords)
        
        return {
            "requires_multi_file_coordination": is_complex or is_infrastructure,
            "config_files_size_kb": 50 if is_complex else 10,
            "is_infrastructure_change": is_infrastructure,
            "requires_deep_reasoning": is_complex,
            "is_quick_fix": is_quick,
            "estimated_time_minutes": 30 if is_complex else (5 if is_quick else 15),
            "subtasks_count": 10 if is_complex else (1 if is_quick else 3),
            "complexity": "complex" if is_complex else ("simple" if is_quick else "medium"),
            "risk_level": "high" if is_complex else ("low" if is_quick else "medium")
        }
    
    def _decide_routing(self, analysis: Dict, available_providers: list, context: Dict) -> Dict[str, Any]:
        """Принятие решения о routing на основе анализа"""
        
        # Claude Code для глубоких операций
        if all([
            'claude' in available_providers,
            any([
                analysis.get('requires_multi_file_coordination'),
                analysis.get('config_files_size_kb', 0) > 100,
                analysis.get('is_infrastructure_change'),
                analysis.get('requires_deep_reasoning'),
                analysis.get('complexity') == 'complex',
            ])
        ]):
            return {
                "orchestrator_mode": "ralph_internal",
                "runtime": "claude",
                "model": "claude-4.5-opus",
                "agent_type": "Claude Code Agent",
                "reason": "Complex DevOps task with multi-file coordination, needs 200K context",
                "confidence": 0.9
            }
        
        # Ralph CLI для multi-step задач
        if all([
            'ralph' in available_providers,
            analysis.get('subtasks_count', 0) > 5,
            analysis.get('complexity') in ['medium', 'complex'],
        ]):
            return {
                "orchestrator_mode": "ralph_cli",
                "runtime": "ralph",
                "model": "cursor",  # Backend для Ralph
                "agent_type": "Ralph Wiggum Agent",
                "reason": "Multi-step task, Ralph orchestrator optimal",
                "confidence": 0.85
            }
        
        # Cursor для быстрых задач
        if all([
            'cursor' in available_providers,
            analysis.get('is_quick_fix'),
            analysis.get('estimated_time_minutes', 0) < 10,
        ]):
            return {
                "orchestrator_mode": "react",
                "runtime": "cursor",
                "model": "auto",
                "agent_type": "ReAct Agent",
                "reason": "Quick fix, Cursor CLI fastest",
                "confidence": 0.95
            }
        
        # Default: Ralph Internal с Cursor
        if 'cursor' in available_providers:
            return {
                "orchestrator_mode": "ralph_internal",
                "runtime": "cursor",
                "model": "auto",
                "agent_type": "Ralph Wiggum Agent",
                "reason": "Standard task, Ralph Internal for iterative improvement",
                "confidence": 0.7
            }
        
        # Fallback to Claude if available
        if 'claude' in available_providers:
            return {
                "orchestrator_mode": "ralph_internal",
                "runtime": "claude",
                "model": "claude-4.5-sonnet",
                "agent_type": "Claude Code Agent",
                "reason": "Default with Claude CLI",
                "confidence": 0.7
            }
        
        # Last resort: internal with Grok API
        return {
            "orchestrator_mode": "react",
            "runtime": "internal",
            "model": "grok",
            "agent_type": "ReAct Agent",
            "reason": "No CLI available, using internal with Grok API",
            "confidence": 0.5
        }
    
    def _fallback_routing(self, available_providers: list) -> Dict[str, Any]:
        """Fallback routing когда предпочтительный провайдер недоступен"""
        # Приоритет: cursor > claude > ralph > grok
        if 'cursor' in available_providers:
            return {
                "orchestrator_mode": "ralph_internal",
                "runtime": "cursor",
                "model": "auto",
                "agent_type": "Ralph Wiggum Agent",
                "reason": "Fallback to Cursor",
                "confidence": 0.6
            }
        elif 'claude' in available_providers:
            return {
                "orchestrator_mode": "ralph_internal",
                "runtime": "claude",
                "model": "claude-4.5-sonnet",
                "agent_type": "Claude Code Agent",
                "reason": "Fallback to Claude",
                "confidence": 0.6
            }
        elif 'ralph' in available_providers:
            return {
                "orchestrator_mode": "ralph_cli",
                "runtime": "ralph",
                "model": "cursor",
                "agent_type": "Ralph Wiggum Agent",
                "reason": "Fallback to Ralph CLI",
                "confidence": 0.5
            }
        else:
            return self._default_routing()
    
    def _default_routing(self) -> Dict[str, Any]:
        """Дефолтный routing (last resort)"""
        return {
            "orchestrator_mode": "react",
            "runtime": "internal",
            "model": "grok",
            "agent_type": "ReAct Agent",
            "reason": "Default routing (no CLI available)",
            "confidence": 0.4
        }
    
    async def route_task(self, task) -> Dict[str, Any]:
        """
        Routing для Task model instance
        
        Args:
            task: tasks.models.Task instance
        
        Returns:
            Dict с рекомендациями
        """
        context = {
            'server_name': task.target_server.name if task.target_server else None,
            'priority': task.priority,
            'estimated_hours': task.estimated_duration_hours,
        }
        
        return await self.route(task.title, task.description, context)


# Global router instance
_smart_router = None


def get_smart_router() -> SmartTaskRouter:
    """Get or create global smart router instance"""
    global _smart_router
    if _smart_router is None:
        _smart_router = SmartTaskRouter()
    return _smart_router
