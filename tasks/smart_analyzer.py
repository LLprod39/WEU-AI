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

from .models import Task, SubTask, TaskNotification, TaskExecution, TaskExecutionSettings
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
        5. Создание уведомлений с учётом настроек пользователя
        """
        result = {
            'servers_detected': [],
            'servers_matched': [],
            'can_auto_execute': False,
            'suggestions': [],
            'estimated_duration_hours': None,
            'recommended_agent': None,
        }
        
        # Получаем настройки пользователя
        settings = TaskExecutionSettings.get_for_user(user)
        
        # 1. Извлечение серверов из описания
        text_to_analyze = f"{task.title}\n{task.description}"
        detected_servers = self._extract_server_mentions(text_to_analyze, user)
        result['servers_detected'] = detected_servers
        
        # 2. Сопоставление с базой серверов
        matched_servers = self._match_servers(detected_servers, user)
        result['servers_matched'] = matched_servers
        
        # 3. Контекст серверов для ИИ (имя, хост, порт — без паролей)
        user_servers = Server.objects.filter(user=user, is_active=True)
        servers_context = [
            {"name": s.name, "host": s.host, "port": getattr(s, 'port', 22)}
            for s in user_servers
        ]
        
        # Список серверов для выбора в UI
        available_servers = [
            {"id": s.id, "name": s.name, "host": s.host}
            for s in user_servers
        ]
        
        # 4. Анализ через ИИ: может ли ИИ выполнить задачу (can_delegate_to_ai, reason, recommended_agent, ...)
        ai_analysis = async_to_sync(self.ai_assistant.analyze_task)(
            task.title,
            task.description,
            servers_context=servers_context,
        )
        
        if ai_analysis.get('success') and ai_analysis.get('analysis'):
            analysis = ai_analysis['analysis']
            result['recommended_agent'] = analysis.get('recommended_agent', 'react')
            result['ai_reason'] = analysis.get('reason', '')
            result['missing_info'] = analysis.get('missing_info')
            result['risks'] = analysis.get('risks')
            result['estimated_duration_hours'] = self._parse_duration(
                analysis.get('estimated_time', '')
            )
            task.ai_agent_type = result['recommended_agent']
            if result['estimated_duration_hours']:
                task.estimated_duration_hours = result['estimated_duration_hours']
            
            # Если ИИ определил сервер по контексту — попробуем найти его
            ai_target_server = analysis.get('target_server_name')
            if ai_target_server and not matched_servers:
                # ИИ нашёл сервер по контексту, ищем в базе
                ai_matched = self._match_servers(
                    [{'mentioned_name': ai_target_server, 'type': 'ai_detected', 'confidence': 'medium'}],
                    user
                )
                if ai_matched:
                    matched_servers = ai_matched
                    result['servers_matched'] = matched_servers
            
            # Если сервер не найден, но есть сервер по умолчанию — используем его
            if not matched_servers and settings.default_server:
                matched_servers = [{
                    'server': settings.default_server,
                    'mentioned_name': settings.default_server.name,
                    'match_type': 'default',
                    'confidence': 'low'
                }]
                result['servers_matched'] = matched_servers
            
            # 5. Логика создания уведомлений с учётом настроек
            can_delegate = analysis.get('can_delegate_to_ai') is True
            missing_info = analysis.get('missing_info')
            complexity = analysis.get('complexity', 'medium')
            
            # Проверяем, нужны ли уточняющие вопросы
            if missing_info and settings.ask_questions_before_execution:
                task.save()
                self._create_questions_notification(task, user, analysis, matched_servers, available_servers)
            elif matched_servers and can_delegate:
                result['can_auto_execute'] = True
                task.target_server = matched_servers[0]['server']
                task.server_name_mentioned = matched_servers[0]['mentioned_name']
                task.save()
                
                # Проверяем настройки: требуется ли подтверждение сервера
                if settings.require_server_confirmation:
                    # Всегда требуем подтверждение сервера
                    self._create_server_confirmation_notification(
                        task, user, matched_servers[0], analysis, available_servers
                    )
                elif settings.auto_execute_simple_tasks and complexity == 'simple':
                    # Авто-выполнение простых задач — сразу создаём уведомление о начале
                    self._create_auto_execution_notification(task, user, matched_servers[0], analysis, available_servers)
                else:
                    # Стандартное уведомление о предложении выполнения
                    self._create_auto_execution_notification(task, user, matched_servers[0], analysis, available_servers)
            else:
                task.save()
                # Создаём уведомление с объяснением почему ИИ не может выполнить
                self._create_analysis_result_notification(task, user, analysis, matched_servers, available_servers)
        else:
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
        server_match: Dict[str, Any],
        analysis: Dict[str, Any] = None,
        available_servers: List[Dict[str, Any]] = None
    ):
        """Создание уведомления о предложении автоматического выполнения"""
        server = server_match['server']
        
        reason = (analysis or {}).get('reason', '')
        estimated_time = (analysis or {}).get('estimated_time', '')
        complexity = (analysis or {}).get('complexity', '')
        risks = (analysis or {}).get('risks')
        
        message_parts = [
            f'🖥️ Обнаружен сервер: **{server.name}** ({server.host})',
            f'📋 Задача: «{task.title}»',
            '',
        ]
        if reason:
            message_parts.append(f'✅ {reason}')
        if estimated_time:
            message_parts.append(f'⏱️ Оценка времени: {estimated_time}')
        if complexity:
            complexity_emoji = {'simple': '🟢', 'medium': '🟡', 'complex': '🔴'}.get(complexity, '⚪')
            message_parts.append(f'{complexity_emoji} Сложность: {complexity}')
        if risks:
            message_parts.append(f'⚠️ Риски: {risks}')
        message_parts.append('')
        message_parts.append('Хотите делегировать выполнение ИИ?')
        
        notification = TaskNotification.objects.create(
            task=task,
            user=user,
            notification_type='AUTO_EXECUTION_SUGGESTION',
            title=f'🤖 Могу выполнить задачу на {server.name}',
            message='\n'.join(message_parts),
            action_data={
                'task_id': task.id,
                'server_id': server.id,
                'server_name': server.name,
                'match_type': server_match['match_type'],
                'action': 'delegate',
                'analysis': analysis,
                'available_servers': available_servers or [],
            },
            action_url=f'/tasks/{task.id}/approve-auto-execution/',
        )
        
        task.auto_execution_suggested = True
        task.save()
        
        logger.info(f"Created auto-execution notification for task {task.id} and server {server.id}")
    
    def _create_server_confirmation_notification(
        self,
        task: Task,
        user: User,
        server_match: Dict[str, Any],
        analysis: Dict[str, Any] = None,
        available_servers: List[Dict[str, Any]] = None
    ):
        """Создание уведомления для подтверждения сервера перед выполнением"""
        server = server_match['server']
        match_type = server_match.get('match_type', 'unknown')
        
        reason = (analysis or {}).get('reason', '')
        estimated_time = (analysis or {}).get('estimated_time', '')
        complexity = (analysis or {}).get('complexity', '')
        risks = (analysis or {}).get('risks')
        
        # Формируем сообщение о способе определения сервера
        match_explanation = {
            'exact_name': 'Сервер определён по точному совпадению названия в тексте задачи',
            'exact_host': 'Сервер определён по совпадению хоста в тексте задачи',
            'partial_name': 'Сервер определён по частичному совпадению названия',
            'ai_detected': 'Сервер определён ИИ на основе контекста задачи',
            'default': 'Используется сервер по умолчанию (сервер не указан в задаче)',
        }.get(match_type, 'Сервер определён автоматически')
        
        message_parts = [
            f'📋 Задача: «{task.title}»',
            '',
            f'🖥️ **Я собираюсь выполнить эту задачу на сервере:**',
            f'**{server.name}** ({server.host})',
            '',
            f'ℹ️ {match_explanation}',
            '',
        ]
        
        if reason:
            message_parts.append(f'✅ {reason}')
        if estimated_time:
            message_parts.append(f'⏱️ Оценка времени: {estimated_time}')
        if complexity:
            complexity_emoji = {'simple': '🟢', 'medium': '🟡', 'complex': '🔴'}.get(complexity, '⚪')
            message_parts.append(f'{complexity_emoji} Сложность: {complexity}')
        if risks:
            message_parts.append(f'⚠️ Риски: {risks}')
        
        message_parts.append('')
        message_parts.append('**Подтвердите сервер или выберите другой:**')
        
        notification = TaskNotification.objects.create(
            task=task,
            user=user,
            notification_type='SERVER_CONFIRMATION',
            title=f'❓ Подтвердите: выполнить на {server.name}?',
            message='\n'.join(message_parts),
            action_data={
                'task_id': task.id,
                'server_id': server.id,
                'server_name': server.name,
                'match_type': match_type,
                'action': 'confirm_server',
                'analysis': analysis,
                'available_servers': available_servers or [],
            },
            action_url=f'/tasks/{task.id}/approve-auto-execution/',
        )
        
        task.auto_execution_suggested = True
        task.save()
        
        logger.info(f"Created server confirmation notification for task {task.id} and server {server.id}")
    
    def _create_questions_notification(
        self,
        task: Task,
        user: User,
        analysis: Dict[str, Any],
        matched_servers: List[Dict[str, Any]],
        available_servers: List[Dict[str, Any]] = None
    ):
        """Создание уведомления с уточняющими вопросами"""
        missing_info = analysis.get('missing_info', '')
        reason = analysis.get('reason', '')
        target_server_name = analysis.get('target_server_name')
        
        message_parts = [
            f'📋 Задача: «{task.title}»',
            '',
            '❓ **Для выполнения задачи нужна дополнительная информация:**',
            '',
            f'{missing_info}',
            '',
        ]
        
        if reason:
            message_parts.append(f'💬 {reason}')
            message_parts.append('')
        
        if matched_servers:
            server = matched_servers[0]['server']
            message_parts.append(f'🖥️ Предполагаемый сервер: **{server.name}** ({server.host})')
        elif target_server_name:
            message_parts.append(f'🖥️ Упомянутый сервер: {target_server_name} (не найден в вашем списке)')
        else:
            message_parts.append('🖥️ Сервер не определён — выберите сервер для выполнения')
        
        message_parts.append('')
        message_parts.append('Ответьте на вопросы и я смогу выполнить задачу.')
        
        # Формируем список вопросов для структурированного ответа
        questions = self._parse_questions(missing_info)
        
        notification = TaskNotification.objects.create(
            task=task,
            user=user,
            notification_type='QUESTIONS_REQUIRED',
            title='❓ Уточните детали задачи',
            message='\n'.join(message_parts),
            action_data={
                'task_id': task.id,
                'server_id': matched_servers[0]['server'].id if matched_servers else None,
                'server_name': matched_servers[0]['server'].name if matched_servers else None,
                'action': 'answer_questions',
                'questions': questions,
                'analysis': analysis,
                'available_servers': available_servers or [],
            },
        )
        
        logger.info(f"Created questions notification for task {task.id}")
    
    def _parse_questions(self, missing_info: str) -> List[Dict[str, str]]:
        """Парсинг текста с вопросами в структурированный список"""
        if not missing_info:
            return []
        
        questions = []
        # Пробуем разбить по номерам (1. 2. 3.) или по переносам строк
        lines = missing_info.split('\n')
        for line in lines:
            line = line.strip()
            if not line:
                continue
            # Убираем номера и маркеры
            line = re.sub(r'^[\d\.\)\-\*]+\s*', '', line)
            if line:
                questions.append({
                    'id': f'q_{len(questions) + 1}',
                    'question': line,
                    'answer': ''
                })
        
        # Если не удалось разбить — один вопрос
        if not questions:
            questions.append({
                'id': 'q_1',
                'question': missing_info,
                'answer': ''
            })
        
        return questions
    
    def _create_analysis_result_notification(
        self,
        task: Task,
        user: User,
        analysis: Dict[str, Any],
        matched_servers: List[Dict[str, Any]],
        available_servers: List[Dict[str, Any]] = None
    ):
        """Создание уведомления о результате анализа когда ИИ не может выполнить задачу"""
        reason = analysis.get('reason', 'Не удалось определить причину')
        missing_info = analysis.get('missing_info')
        risks = analysis.get('risks')
        target_server = analysis.get('target_server_name')
        can_delegate = analysis.get('can_delegate_to_ai', False)
        
        # Определяем тип уведомления
        if not matched_servers and not target_server:
            # Сервер не найден
            title = '❓ Не удалось определить сервер'
            notification_type = 'WARNING'
        elif risks and not can_delegate:
            # Есть риски, ИИ отказывается
            title = '⚠️ Требуется подтверждение для опасной операции'
            notification_type = 'WARNING'
        elif missing_info:
            # Нужна дополнительная информация
            title = '❓ Нужна дополнительная информация'
            notification_type = 'INFO'
        else:
            title = '📋 Анализ задачи завершён'
            notification_type = 'INFO'
        
        message_parts = [f'📋 Задача: «{task.title}»', '']
        
        if target_server:
            message_parts.append(f'🖥️ Определён сервер: {target_server}')
            if not matched_servers:
                message_parts.append('⚠️ Сервер не найден в вашем списке серверов. Добавьте его в раздел Servers.')
        elif not matched_servers:
            message_parts.append('🔍 Сервер не указан в задаче и не удалось определить из контекста.')
            if available_servers:
                message_parts.append('Выберите сервер из списка для выполнения задачи.')
        
        message_parts.append('')
        message_parts.append(f'💬 {reason}')
        
        if missing_info:
            message_parts.append('')
            message_parts.append(f'❓ Уточните: {missing_info}')
        
        if risks:
            message_parts.append('')
            message_parts.append(f'⚠️ Риски: {risks}')
        
        TaskNotification.objects.create(
            task=task,
            user=user,
            notification_type=notification_type,
            title=title,
            message='\n'.join(message_parts),
            action_data={
                'task_id': task.id,
                'analysis': analysis,
                'available_servers': available_servers or [],
                'action': 'select_server' if not matched_servers else None,
            },
        )
        
        logger.info(f"Created analysis result notification for task {task.id}: {notification_type}")
    
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
    
    def change_server_and_approve(self, task: Task, user: User, new_server_id: int) -> bool:
        """Изменить сервер для задачи и одобрить выполнение"""
        try:
            new_server = Server.objects.get(id=new_server_id, user=user, is_active=True)
            task.target_server = new_server
            task.server_name_mentioned = new_server.name
            task.save()
            
            logger.info(f"Changed server for task {task.id} to {new_server.name}")
            return self.approve_auto_execution(task, user)
        except Server.DoesNotExist:
            logger.error(f"Server {new_server_id} not found for user {user.id}")
            return False
    
    def reanalyze_with_answers(
        self,
        task: Task,
        user: User,
        answers: List[Dict[str, str]],
        selected_server_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Повторный анализ задачи с ответами на уточняющие вопросы
        
        Args:
            task: Задача
            user: Пользователь
            answers: Список ответов на вопросы [{'question': '...', 'answer': '...'}]
            selected_server_id: ID выбранного сервера (если указан)
        """
        # Формируем дополнительный контекст из ответов
        answers_text = "\n".join([
            f"Вопрос: {a.get('question', '')}\nОтвет: {a.get('answer', '')}"
            for a in answers if a.get('answer')
        ])
        
        # Обновляем описание задачи с ответами
        original_description = task.description
        if answers_text:
            task.description = f"{original_description}\n\n--- Дополнительная информация ---\n{answers_text}"
        
        # Если указан сервер — устанавливаем его
        if selected_server_id:
            try:
                server = Server.objects.get(id=selected_server_id, user=user, is_active=True)
                task.target_server = server
                task.server_name_mentioned = server.name
            except Server.DoesNotExist:
                pass
        
        task.save()
        
        # Повторный анализ
        result = self.analyze_task(task, user)
        
        # Восстанавливаем оригинальное описание (ответы сохранены в action_data уведомления)
        task.description = original_description
        task.save()
        
        return result