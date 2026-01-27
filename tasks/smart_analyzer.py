"""
Умный анализатор задач
Анализирует задачи, извлекает информацию о серверах, предлагает автоматическое выполнение
"""
import re
from typing import Dict, List, Optional, Tuple, Any
from django.contrib.auth.models import User
from django.utils import timezone
from loguru import logger
from asgiref.sync import async_to_sync

from .models import Task, SubTask, TaskNotification, TaskExecution
from servers.models import Server
from .ai_assistant import TaskAIAssistant


class SmartTaskAnalyzer:
    """Умный анализатор задач"""
    
    def __init__(self):
        self.ai_assistant = TaskAIAssistant()
    
    def analyze_task(self, task: Task, user: User) -> Dict[str, Any]:
        """
        Полный анализ задачи:
        1. Извлечение упоминаний серверов
        2. Сопоставление с базой серверов
        3. Оценка возможности автоматического выполнения
        4. Разбиение на подзадачи с таймингами
        """
        result = {
            'servers_detected': [],
            'servers_matched': [],
            'can_auto_execute': False,
            'suggestions': [],
            'estimated_duration_hours': None,
            'recommended_agent': None,
        }
        
        # 1. Извлечение серверов из описания
        text_to_analyze = f"{task.title}\n{task.description}"
        detected_servers = self._extract_server_mentions(text_to_analyze, user)
        result['servers_detected'] = detected_servers
        
        # 2. Сопоставление с базой серверов
        matched_servers = self._match_servers(detected_servers, user)
        result['servers_matched'] = matched_servers
        
        # 3. Если найден сервер - предлагаем автоматическое выполнение
        if matched_servers:
            result['can_auto_execute'] = True
            # Сохраняем первый найденный сервер
            task.target_server = matched_servers[0]['server']
            task.server_name_mentioned = matched_servers[0]['mentioned_name']
            task.save()
            
            # Создаем уведомление о предложении автоматического выполнения
            self._create_auto_execution_notification(task, user, matched_servers[0])
        
        # 4. Анализ через ИИ для разбиения и оценки
        ai_analysis = async_to_sync(self.ai_assistant.analyze_task)(
            task.title,
            task.description
        )
        
        if ai_analysis.get('success') and ai_analysis.get('analysis'):
            analysis = ai_analysis['analysis']
            result['recommended_agent'] = analysis.get('recommended_agent', 'react')
            result['estimated_duration_hours'] = self._parse_duration(
                analysis.get('estimated_time', '')
            )
            
            # Сохраняем рекомендации в задачу
            task.ai_agent_type = result['recommended_agent']
            if result['estimated_duration_hours']:
                task.estimated_duration_hours = result['estimated_duration_hours']
            task.save()
        
        return result
    
    def _extract_server_mentions(self, text: str, user: User) -> List[Dict[str, str]]:
        """Извлечение упоминаний серверов из текста"""
        mentions = []
        
        # Получаем все серверы пользователя для поиска
        user_servers = Server.objects.filter(user=user, is_active=True)
        server_names = {s.name.lower(): s for s in user_servers}
        server_hosts = {s.host.lower(): s for s in user_servers}
        
        # Поиск по названиям серверов
        for server_name, server in server_names.items():
            # Ищем точное совпадение или в составе слова
            pattern = r'\b' + re.escape(server_name) + r'\b'
            if re.search(pattern, text, re.IGNORECASE):
                mentions.append({
                    'mentioned_name': server_name,
                    'type': 'name',
                    'confidence': 'high'
                })
        
        # Поиск по хостам
        for host, server in server_hosts.items():
            pattern = r'\b' + re.escape(host) + r'\b'
            if re.search(pattern, text, re.IGNORECASE):
                mentions.append({
                    'mentioned_name': host,
                    'type': 'host',
                    'confidence': 'high'
                })
        
        # Поиск паттернов типа "сервер X", "на сервере Y"
        server_patterns = [
            r'(?:на|с|от|к|для)\s+(?:сервере?|server|хост|host)\s+([a-zA-Z0-9._-]+)',
            r'(?:сервер|server|хост|host)\s+([a-zA-Z0-9._-]+)',
            r'([a-zA-Z0-9._-]+)\s+(?:сервер|server)',
        ]
        
        for pattern in server_patterns:
            matches = re.finditer(pattern, text, re.IGNORECASE)
            for match in matches:
                mentioned = match.group(1).strip()
                if mentioned and mentioned not in [m['mentioned_name'] for m in mentions]:
                    mentions.append({
                        'mentioned_name': mentioned,
                        'type': 'pattern',
                        'confidence': 'medium'
                    })
        
        return mentions
    
    def _match_servers(self, mentions: List[Dict], user: User) -> List[Dict[str, Any]]:
        """Сопоставление упоминаний с реальными серверами"""
        matched = []
        user_servers = Server.objects.filter(user=user, is_active=True)
        
        for mention in mentions:
            mentioned_name = mention['mentioned_name'].lower()
            
            # Точное совпадение по имени
            server = user_servers.filter(name__iexact=mentioned_name).first()
            if server:
                matched.append({
                    'server': server,
                    'mentioned_name': mention['mentioned_name'],
                    'match_type': 'exact_name',
                    'confidence': 'high'
                })
                continue
            
            # Точное совпадение по хосту
            server = user_servers.filter(host__iexact=mentioned_name).first()
            if server:
                matched.append({
                    'server': server,
                    'mentioned_name': mention['mentioned_name'],
                    'match_type': 'exact_host',
                    'confidence': 'high'
                })
                continue
            
            # Частичное совпадение по имени
            server = user_servers.filter(name__icontains=mentioned_name).first()
            if server:
                matched.append({
                    'server': server,
                    'mentioned_name': mention['mentioned_name'],
                    'match_type': 'partial_name',
                    'confidence': 'medium'
                })
                continue
        
        return matched
    
    def _parse_duration(self, duration_str: str) -> Optional[float]:
        """Парсинг строки с оценкой времени в часы"""
        if not duration_str:
            return None
        
        duration_str = duration_str.lower().strip()
        
        # Паттерны: "2 hours", "3 дня", "1.5 часа", "30 минут"
        patterns = [
            (r'(\d+\.?\d*)\s*(?:час|hour|ч|h)', 1.0),  # часы
            (r'(\d+\.?\d*)\s*(?:день|day|д|d)', 24.0),  # дни
            (r'(\d+\.?\d*)\s*(?:минут|minute|мин|m)', 1/60.0),  # минуты
        ]
        
        for pattern, multiplier in patterns:
            match = re.search(pattern, duration_str)
            if match:
                try:
                    value = float(match.group(1))
                    return value * multiplier
                except ValueError:
                    continue
        
        return None
    
    def _create_auto_execution_notification(
        self,
        task: Task,
        user: User,
        server_match: Dict[str, Any]
    ):
        """Создание уведомления о предложении автоматического выполнения"""
        server = server_match['server']
        
        notification = TaskNotification.objects.create(
            task=task,
            user=user,
            notification_type='AUTO_EXECUTION_SUGGESTION',
            title=f'Обнаружен сервер "{server.name}" в задаче',
            message=(
                f'В задаче "{task.title}" обнаружен сервер "{server.name}" ({server.host}).\n'
                f'Хотите, чтобы я автоматически подключился к серверу и начал выполнение задачи?'
            ),
            action_data={
                'server_id': server.id,
                'server_name': server.name,
                'task_id': task.id,
                'match_type': server_match['match_type'],
            },
            action_url=f'/tasks/{task.id}/auto-execute/',
        )
        
        task.auto_execution_suggested = True
        task.save()
        
        logger.info(f"Created auto-execution notification for task {task.id} and server {server.id}")
    
    def breakdown_task_with_timings(self, task: Task) -> List[Dict[str, Any]]:
        """
        Разбиение задачи на подзадачи с таймингами через ИИ
        """
        # Получаем разбиение через ИИ
        subtasks_titles = async_to_sync(self.ai_assistant.breakdown_task)(
            task.title,
            task.description
        )
        
        if not subtasks_titles:
            return []
        
        # Для каждой подзадачи получаем оценку времени через ИИ
        subtasks_with_timing = []
        total_minutes = 0
        
        for idx, subtask_title in enumerate(subtasks_titles):
            # Оцениваем время для подзадачи
            estimated_minutes = self._estimate_subtask_duration(
                task.title,
                task.description,
                subtask_title
            )
            
            subtasks_with_timing.append({
                'title': subtask_title,
                'order': idx + 1,
                'estimated_duration_minutes': estimated_minutes,
            })
            
            if estimated_minutes:
                total_minutes += estimated_minutes
        
        # Обновляем общую оценку задачи
        if total_minutes:
            task.estimated_duration_hours = total_minutes / 60.0
            task.save()
        
        return subtasks_with_timing
    
    def _estimate_subtask_duration(
        self,
        task_title: str,
        task_description: str,
        subtask_title: str
    ) -> Optional[int]:
        """Оценка времени выполнения подзадачи через ИИ"""
        try:
            model = async_to_sync(lambda: self.ai_assistant.llm)()
            from app.core.model_config import model_manager
            
            prompt = f"""Оцени время выполнения следующей подзадачи в минутах.

Задача: {task_title}
Описание задачи: {task_description}
Подзадача: {subtask_title}

Верни только число - количество минут. Если не можешь оценить, верни 0.

Примеры ответов:
- Простая задача: 15
- Средняя задача: 30
- Сложная задача: 60
- Очень сложная: 120

Ответ (только число):"""
            
            # Используем синхронный вызов для простоты
            from app.core.llm import LLMProvider
            llm = LLMProvider()
            response_text = ""
            
            async def get_response():
                nonlocal response_text
                async for chunk in llm.stream_chat(prompt, model=model_manager.config.default_provider):
                    response_text += chunk
            
            async_to_sync(get_response)()
            
            # Извлекаем число из ответа
            numbers = re.findall(r'\d+', response_text)
            if numbers:
                return int(numbers[0])
            
            return None
        except Exception as e:
            logger.error(f"Error estimating subtask duration: {e}")
            return None
    
    def approve_auto_execution(self, task: Task, user: User) -> bool:
        """Одобрение автоматического выполнения задачи"""
        if not task.target_server:
            return False
        
        task.auto_execution_approved = True
        task.assigned_to_ai = True
        task.ai_execution_status = 'PENDING'
        task.save()
        
        # Создаем запись о выполнении
        execution = TaskExecution.objects.create(
            task=task,
            agent_type=task.ai_agent_type or 'react',
            status='PENDING'
        )
        
        logger.info(f"Auto-execution approved for task {task.id}")
        return True
