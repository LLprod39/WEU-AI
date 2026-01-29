"""
SmartTaskAnalyzer - умный анализ задач для Ralph Orchestrator.

Функции:
- Анализ задачи и генерация наводящих вопросов
- Автоматическая рекомендация модели по типу задачи
- Декомпозиция на подзадачи с рекомендованными моделями
- Оценка сложности задачи

Использует Cursor CLI в режиме --ask для анализа (без внесения изменений).
"""

import json
import re
import subprocess
import shutil
import os
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any, Optional
from enum import Enum

from django.conf import settings
from loguru import logger


class TaskComplexity(Enum):
    SIMPLE = "simple"       # Простые задачи: рефакторинг, lint-fix, форматирование
    STANDARD = "standard"   # Стандартные: новый код, фичи
    COMPLEX = "complex"     # Сложные: архитектура, дизайн
    DEBUG = "debug"         # Дебаг, анализ ошибок


class TaskType(Enum):
    REFACTORING = "refactoring"      # Рефакторинг кода
    LINT_FIX = "lint_fix"            # Исправление lint ошибок
    NEW_FEATURE = "new_feature"      # Новая функциональность
    BUG_FIX = "bug_fix"              # Исправление багов
    ARCHITECTURE = "architecture"    # Архитектурные решения
    TESTING = "testing"              # Написание тестов
    DOCUMENTATION = "documentation"  # Документация
    DEPLOYMENT = "deployment"        # Деплой, CI/CD
    UNKNOWN = "unknown"              # Неопределённый тип


@dataclass
class Subtask:
    """Подзадача с рекомендованной моделью."""
    title: str
    prompt: str
    recommended_model: str
    reasoning: str
    complexity: str = "standard"
    completion_promise: str = "STEP_DONE"
    max_iterations: int = 5
    verify_prompt: Optional[str] = None
    verify_promise: str = "PASS"


@dataclass
class AnalysisResult:
    """Результат анализа задачи."""
    questions: List[str] = field(default_factory=list)
    recommended_model: str = "auto"
    complexity: str = "standard"
    task_type: str = "unknown"
    subtasks: List[Subtask] = field(default_factory=list)
    estimated_steps: int = 1
    warnings: List[str] = field(default_factory=list)
    reasoning: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        result = asdict(self)
        result["subtasks"] = [asdict(s) for s in self.subtasks]
        return result


class SmartTaskAnalyzer:
    """
    Анализатор задач для автоматического подбора моделей и декомпозиции.
    """
    
    # Ключевые слова для определения типа задачи
    TASK_TYPE_KEYWORDS = {
        TaskType.REFACTORING: [
            "рефакторинг", "refactor", "переименовать", "rename", "реструктурировать",
            "оптимизировать", "optimize", "упростить", "simplify", "clean up"
        ],
        TaskType.LINT_FIX: [
            "lint", "eslint", "pylint", "flake8", "форматирование", "formatting",
            "prettier", "black", "isort", "code style"
        ],
        TaskType.BUG_FIX: [
            "баг", "bug", "ошибка", "error", "исправить", "fix", "починить",
            "не работает", "doesn't work", "broken", "crash", "debug"
        ],
        TaskType.NEW_FEATURE: [
            "добавить", "add", "создать", "create", "новый", "new", "implement",
            "реализовать", "функционал", "feature", "функция"
        ],
        TaskType.ARCHITECTURE: [
            "архитектура", "architecture", "дизайн", "design", "структура",
            "паттерн", "pattern", "рефакторинг всего", "масштабный"
        ],
        TaskType.TESTING: [
            "тест", "test", "pytest", "unittest", "jest", "coverage",
            "проверка", "verify", "тестирование"
        ],
        TaskType.DOCUMENTATION: [
            "документация", "documentation", "readme", "описание", "комментарии",
            "docstring", "jsdoc", "swagger", "api doc"
        ],
        TaskType.DEPLOYMENT: [
            "деплой", "deploy", "docker", "kubernetes", "k8s", "ci/cd",
            "github actions", "pipeline", "production"
        ],
    }
    
    # Ключевые слова для определения сложности
    COMPLEXITY_KEYWORDS = {
        TaskComplexity.SIMPLE: [
            "простой", "simple", "быстро", "quick", "мелкий", "minor",
            "одна строка", "one line", "переименовать", "rename"
        ],
        TaskComplexity.COMPLEX: [
            "сложный", "complex", "масштабный", "large", "архитектура",
            "много файлов", "multiple files", "весь проект", "entire project"
        ],
        TaskComplexity.DEBUG: [
            "дебаг", "debug", "отладка", "trace", "профилирование",
            "memory leak", "performance", "bottleneck"
        ],
    }
    
    def __init__(self):
        self.model_recommendations = getattr(settings, "MODEL_RECOMMENDATIONS", {
            "simple": "gpt-5",
            "standard": "sonnet-4",
            "complex": "sonnet-4-thinking",
            "debug": "sonnet-4-thinking",
        })
    
    def _detect_task_type(self, task: str) -> TaskType:
        """Определяет тип задачи по ключевым словам."""
        task_lower = task.lower()
        
        scores = {task_type: 0 for task_type in TaskType}
        
        for task_type, keywords in self.TASK_TYPE_KEYWORDS.items():
            for keyword in keywords:
                if keyword.lower() in task_lower:
                    scores[task_type] += 1
        
        # Находим тип с максимальным счётом
        max_score = max(scores.values())
        if max_score > 0:
            for task_type, score in scores.items():
                if score == max_score:
                    return task_type
        
        return TaskType.UNKNOWN
    
    def _detect_complexity(self, task: str, task_type: TaskType) -> TaskComplexity:
        """Определяет сложность задачи."""
        task_lower = task.lower()
        
        # Проверяем ключевые слова сложности
        for complexity, keywords in self.COMPLEXITY_KEYWORDS.items():
            for keyword in keywords:
                if keyword.lower() in task_lower:
                    return complexity
        
        # Автоматическое определение по типу задачи
        if task_type in [TaskType.LINT_FIX, TaskType.REFACTORING]:
            return TaskComplexity.SIMPLE
        elif task_type == TaskType.ARCHITECTURE:
            return TaskComplexity.COMPLEX
        elif task_type == TaskType.BUG_FIX:
            return TaskComplexity.DEBUG
        
        return TaskComplexity.STANDARD
    
    def recommend_model(self, task_type: TaskType, complexity: TaskComplexity) -> str:
        """
        Рекомендует модель по типу и сложности задачи.
        
        Правила:
        - Простые задачи (рефакторинг, lint-fix) -> быстрая модель (gpt-5)
        - Стандартные задачи (новый код, фичи) -> сбалансированная (sonnet-4)
        - Сложные задачи (архитектура, дизайн) -> thinking модель (sonnet-4-thinking)
        - Дебаг, анализ ошибок -> thinking модель (sonnet-4-thinking)
        """
        return self.model_recommendations.get(complexity.value, "auto")
    
    def _generate_questions_sync(self, task: str, task_type: TaskType) -> List[str]:
        """
        Больше не генерируем вопросы локально.
        Cursor CLI в режиме plan сам решает задавать вопросы или нет.
        """
        # Вопросы будут приходить от Cursor CLI если нужны
        return []
    
    def _get_cursor_cli_command(self) -> str:
        """Возвращает путь к cursor CLI."""
        cli_path = os.getenv("CURSOR_CLI_PATH")
        if cli_path:
            return cli_path
        return shutil.which("agent") or "agent"
    
    def _analyze_with_cursor_ask(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Анализирует задачу с помощью Cursor CLI в режиме --mode=plan.
        
        Cursor CLI plan mode используется для планирования задач.
        AI сам решает - нужны уточняющие вопросы или можно сразу строить план.
        """
        context_str = ""
        if context:
            if context.get("project_type"):
                context_str += f"\nТип проекта: {context['project_type']}"
            if context.get("existing_files"):
                context_str += f"\nСуществующие файлы: {', '.join(context['existing_files'][:10])}"
        
        prompt = f"""Проанализируй задачу и создай план выполнения.

ЗАДАЧА:
{task}
{context_str}

ВАЖНО: Верни ТОЛЬКО JSON (без ```json, без markdown):

Если задача ПОНЯТНА и можно приступать - верни план:
{{
  "ready": true,
  "subtasks": [
    {{
      "title": "Краткое название",
      "prompt": "Детальное описание что делать для AI-агента",
      "complexity": "simple|standard|complex"
    }}
  ],
  "overall_complexity": "simple|standard|complex",
  "warnings": []
}}

Если задача НЕПОНЯТНА и нужны уточнения - верни вопросы:
{{
  "ready": false,
  "questions": ["Вопрос 1?", "Вопрос 2?"],
  "subtasks": [],
  "overall_complexity": "standard",
  "warnings": []
}}

Правила:
- Не задавай вопросы если задача понятна!
- Максимум 2-3 вопроса только если ДЕЙСТВИТЕЛЬНО непонятно
- Каждая подзадача - конкретное действие для AI-агента
- Порядок: подготовка → реализация → проверка
- Максимум 6 подзадач для сложных задач
- Простая задача = 1-2 подзадачи
"""
        
        # Строим команду для cursor CLI в режиме plan (планирование перед написанием кода)
        # Документация: https://cursor.com/ru/docs/cli/overview
        # Plan mode: спланировать подход перед написанием кода с уточняющими вопросами
        cli_cmd = self._get_cursor_cli_command()
        cmd = [cli_cmd, "-p", "--mode=plan", "--model", "auto", prompt]
        
        logger.info(f"Running Cursor CLI --mode=plan --model auto for task analysis")
        
        try:
            # Запускаем cursor CLI в режиме ask
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,  # 2 минуты таймаут
                env={**os.environ}
            )
            
            response_text = result.stdout or ""
            
            if result.returncode != 0:
                logger.warning(f"Cursor CLI --ask returned code {result.returncode}: {result.stderr}")
                if not response_text:
                    return {"subtasks": [], "overall_complexity": "standard", "warnings": [f"CLI error: {result.stderr[:200]}"]}
            
            # Парсим JSON из ответа
            try:
                return json.loads(response_text)
            except json.JSONDecodeError:
                # Пробуем извлечь JSON из текста
                match = re.search(r"\{[\s\S]*\}", response_text)
                if match:
                    try:
                        return json.loads(match.group())
                    except json.JSONDecodeError:
                        pass
                
                # Пробуем убрать markdown code block
                clean = re.sub(r"```json?\n?", "", response_text)
                clean = re.sub(r"\n?```", "", clean)
                try:
                    return json.loads(clean.strip())
                except json.JSONDecodeError:
                    pass
            
            logger.warning(f"Failed to parse JSON from cursor response: {response_text[:500]}")
            return {"subtasks": [], "overall_complexity": "standard", "warnings": ["Не удалось распарсить ответ"]}
            
        except subprocess.TimeoutExpired:
            logger.error("Cursor CLI --ask timeout")
            return {"subtasks": [], "overall_complexity": "standard", "warnings": ["Таймаут анализа (2 мин)"]}
        except FileNotFoundError:
            logger.error(f"Cursor CLI not found: {cli_cmd}")
            return {"subtasks": [], "overall_complexity": "standard", "warnings": ["Cursor CLI не найден"]}
        except Exception as e:
            logger.error(f"Cursor CLI --ask error: {e}")
            return {"subtasks": [], "overall_complexity": "standard", "warnings": [str(e)[:100]]}
    
    def analyze(self, task: str, context: Optional[Dict[str, Any]] = None, use_llm: bool = True) -> AnalysisResult:
        """
        Анализирует задачу и возвращает результат.
        
        Args:
            task: Описание задачи
            context: Дополнительный контекст (project_type, existing_files)
            use_llm: Использовать Cursor CLI --mode=plan для анализа
            
        Returns:
            AnalysisResult с рекомендациями
        """
        # Базовый анализ по ключевым словам
        task_type = self._detect_task_type(task)
        complexity = self._detect_complexity(task, task_type)
        recommended_model = self.recommend_model(task_type, complexity)
        
        result = AnalysisResult(
            questions=[],  # Вопросы придут от Cursor если нужны
            recommended_model=recommended_model,
            complexity=complexity.value,
            task_type=task_type.value,
            reasoning=f"Тип задачи: {task_type.value}, сложность: {complexity.value}"
        )
        
        # Анализ с Cursor CLI --mode=plan
        if use_llm:
            try:
                llm_result = self._analyze_with_cursor_ask(task, context)
                
                # Cursor вернул вопросы - значит задача непонятна
                if llm_result.get("questions"):
                    result.questions = llm_result["questions"]
                    # Не создаём subtasks пока есть вопросы
                    result.subtasks = []
                    result.warnings = llm_result.get("warnings", [])
                    logger.info(f"Cursor needs clarification: {len(result.questions)} questions")
                    return result
                
                # Cursor готов - создаём подзадачи
                subtasks = []
                for st in llm_result.get("subtasks", []):
                    st_complexity = st.get("complexity", "standard")
                    st_model = self.model_recommendations.get(st_complexity, recommended_model)
                    
                    subtask = Subtask(
                        title=st.get("title", "Шаг"),
                        prompt=st.get("prompt", ""),
                        recommended_model=st_model,
                        reasoning=st.get("reasoning", ""),
                        complexity=st_complexity,
                        verify_prompt=None,
                    )
                    subtasks.append(subtask)
                
                result.subtasks = subtasks
                result.estimated_steps = len(subtasks) or 1
                result.warnings = llm_result.get("warnings", [])
                
                # Обновляем сложность по результату Cursor
                llm_complexity = llm_result.get("overall_complexity")
                if llm_complexity in ["simple", "standard", "complex", "debug"]:
                    result.complexity = llm_complexity
                    result.recommended_model = self.model_recommendations.get(llm_complexity, recommended_model)
                    
            except Exception as e:
                logger.warning(f"Cursor CLI analysis failed: {e}")
                result.warnings.append(f"Cursor анализ недоступен: {str(e)[:100]}")
        
        return result
    
    async def analyze_async(self, task: str, context: Optional[Dict[str, Any]] = None, use_llm: bool = True) -> AnalysisResult:
        """
        Асинхронная версия analyze.
        Примечание: внутренне использует синхронный subprocess для Cursor CLI --ask.
        """
        # Делегируем к синхронной версии (subprocess всё равно синхронный)
        return self.analyze(task, context, use_llm)


# Singleton instance
_analyzer_instance = None


def get_smart_analyzer() -> SmartTaskAnalyzer:
    """Возвращает singleton экземпляр SmartTaskAnalyzer."""
    global _analyzer_instance
    if _analyzer_instance is None:
        _analyzer_instance = SmartTaskAnalyzer()
    return _analyzer_instance
