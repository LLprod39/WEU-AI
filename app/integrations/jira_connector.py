"""
Jira Integration - автоматический импорт и синхронизация задач
"""
import os
from typing import Dict, List, Any, Optional
from loguru import logger
from django.utils import timezone


class JiraConnector:
    """
    Интеграция с Jira:
    - Синхронизация задач по JQL фильтру
    - Автоматический анализ на делегирование AI
    - Обновление статусов обратно в Jira
    - Комментарии с результатами выполнения
    
    Требует: pip install jira
    """
    
    def __init__(self, jira_url: str = None, api_token: str = None, email: str = None):
        """
        Args:
            jira_url: URL Jira instance (https://company.atlassian.net)
            api_token: API token от Jira
            email: Email пользователя для аутентификации
        """
        self.jira_url = jira_url or os.getenv("JIRA_URL", "")
        self.api_token = api_token or os.getenv("JIRA_API_TOKEN", "")
        self.email = email or os.getenv("JIRA_EMAIL", "")
        
        self.jira = None
        self._initialize()
    
    def _initialize(self):
        """Инициализация Jira клиента"""
        if not self.jira_url or not self.api_token:
            logger.warning("Jira not configured (missing JIRA_URL or JIRA_API_TOKEN)")
            return
        
        try:
            from jira import JIRA
            
            # Basic auth: email + API token
            self.jira = JIRA(
                server=self.jira_url,
                basic_auth=(self.email, self.api_token)
            )
            
            logger.success(f"Jira connector initialized: {self.jira_url}")
        
        except ImportError:
            logger.error("Jira library not installed. Install: pip install jira")
        except Exception as e:
            logger.error(f"Failed to initialize Jira: {e}")
    
    @property
    def available(self) -> bool:
        """Проверка доступности Jira"""
        return self.jira is not None
    
    async def sync_tasks(
        self,
        jql_filter: str,
        user_id: int,
        auto_analyze: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Синхронизация задач из Jira по JQL фильтру
        
        Args:
            jql_filter: JQL запрос (например: project = DEVOPS AND status = "To Do")
            user_id: ID пользователя WEU
            auto_analyze: Автоматически анализировать на делегирование AI
        
        Returns:
            List[Dict]: Список импортированных задач
        """
        if not self.available:
            raise Exception("Jira not configured")
        
        try:
            # Поиск issues
            issues = self.jira.search_issues(jql_filter, maxResults=100)
            
            imported_tasks = []
            
            for issue in issues:
                # Проверяем, не импортирована ли уже
                from tasks.models import Task
                existing = Task.objects.filter(
                    external_system='jira',
                    external_id=issue.key
                ).first()
                
                if existing:
                    logger.info(f"Task {issue.key} already exists, skipping")
                    continue
                
                # Анализ: можно ли делегировать на AI?
                analysis = None
                if auto_analyze:
                    analysis = await self._analyze_jira_issue(issue, user_id)
                
                # Создание задачи в WEU
                task = await self._create_weu_task(issue, user_id, analysis)
                imported_tasks.append({
                    'jira_key': issue.key,
                    'weu_task_id': task.id,
                    'can_delegate': analysis.get('can_delegate') if analysis else False
                })
                
                # Комментарий в Jira
                if analysis and analysis.get('can_delegate'):
                    await self._add_jira_comment(
                        issue.key,
                        f"🤖 Задача делегирована на WEU AI Agent\n"
                        f"Agent: {analysis.get('recommended_agent', 'ReAct')}\n"
                        f"Server: {analysis.get('target_server', 'Auto')}\n"
                        f"Confidence: {analysis.get('confidence', 0)}%"
                    )
            
            logger.success(f"Synced {len(imported_tasks)} tasks from Jira")
            return imported_tasks
        
        except Exception as e:
            logger.error(f"Jira sync failed: {e}")
            raise
    
    async def _analyze_jira_issue(self, issue, user_id: int) -> Dict[str, Any]:
        """Анализ Jira issue на возможность делегирования AI"""
        try:
            from tasks.ai_assistant import TaskAIAssistant
            from servers.models import Server
            
            # Получаем серверы пользователя
            servers = Server.objects.filter(user_id=user_id).values('id', 'name', 'host', 'port')
            servers_context = list(servers)
            
            # Анализ через AI Assistant
            assistant = TaskAIAssistant()
            result = await assistant.analyze_task(
                task_title=issue.fields.summary,
                task_description=issue.fields.description or "",
                servers_context=servers_context
            )
            
            return result.get('analysis', {})
        
        except Exception as e:
            logger.error(f"Issue analysis failed: {e}")
            return {'can_delegate': False, 'reason': str(e)}
    
    async def _create_weu_task(self, issue, user_id: int, analysis: Dict = None) -> Any:
        """Создание задачи в WEU из Jira issue"""
        from tasks.models import Task
        from django.contrib.auth.models import User
        
        user = User.objects.get(id=user_id)
        
        # Маппинг приоритетов
        priority_map = {
            'Highest': 'HIGH',
            'High': 'HIGH',
            'Medium': 'MEDIUM',
            'Low': 'LOW',
            'Lowest': 'LOW',
        }
        jira_priority = getattr(issue.fields.priority, 'name', 'Medium') if hasattr(issue.fields, 'priority') else 'Medium'
        weu_priority = priority_map.get(jira_priority, 'MEDIUM')
        
        # Целевой сервер
        target_server = None
        if analysis and analysis.get('target_server_name'):
            from servers.models import Server
            target_server = Server.objects.filter(
                user_id=user_id,
                name__iexact=analysis['target_server_name']
            ).first()
        
        # Создание задачи
        task = Task.objects.create(
            created_by=user,
            title=issue.fields.summary,
            description=issue.fields.description or "",
            priority=weu_priority,
            status='TODO',
            external_system='jira',
            external_id=issue.key,
            external_url=f"{self.jira_url}/browse/{issue.key}",
            sync_back=True,
            target_server=target_server,
        )
        
        # AI делегирование
        if analysis and analysis.get('can_delegate_to_ai'):
            task.assigned_to_ai = True
            task.ai_agent_type = analysis.get('recommended_agent', 'react')
            task.ai_execution_status = 'PENDING'
            task.auto_execution_suggested = True
            task.save()
        
        logger.info(f"Created WEU task {task.id} from Jira {issue.key}")
        return task
    
    async def update_jira_status(self, task, execution) -> bool:
        """
        Обновление статуса задачи в Jira после выполнения
        
        Args:
            task: tasks.models.Task instance
            execution: tasks.models.TaskExecution instance
        
        Returns:
            bool: Success
        """
        if not self.available or not task.sync_back:
            return False
        
        if not task.external_id or task.external_system != 'jira':
            return False
        
        try:
            issue = self.jira.issue(task.external_id)
            
            if execution.status == 'COMPLETED':
                # Успешное выполнение
                try:
                    # Пытаемся перевести в Done
                    transitions = self.jira.transitions(issue)
                    done_transition = next((t for t in transitions if 'done' in t['name'].lower()), None)
                    
                    if done_transition:
                        self.jira.transition_issue(issue, done_transition['id'])
                        logger.info(f"Transitioned {task.external_id} to Done")
                except Exception as e:
                    logger.warning(f"Failed to transition issue: {e}")
                
                # Добавляем комментарий
                comment = f"""✅ Задача выполнена WEU AI Agent

*Agent:* {execution.agent_type}
*Duration:* {execution.actual_duration_minutes or 0} минут
*Completed:* {execution.completed_at.strftime('%Y-%m-%d %H:%M')}

*Result:*
{{code}}
{execution.result_summary[:500]}
{{code}}

[View full execution log in WEU|{self._get_weu_task_url(task.id)}]
"""
                
                await self._add_jira_comment(task.external_id, comment)
            
            elif execution.status == 'FAILED':
                # Ошибка выполнения
                # Добавляем метку
                try:
                    current_labels = issue.fields.labels or []
                    if 'ai-execution-failed' not in current_labels:
                        current_labels.append('ai-execution-failed')
                        issue.update(fields={'labels': current_labels})
                except Exception:
                    pass
                
                # Комментарий
                comment = f"""❌ Ошибка выполнения WEU AI Agent

*Agent:* {execution.agent_type}
*Error:* {execution.error_message[:200]}

[View details in WEU|{self._get_weu_task_url(task.id)}]
"""
                await self._add_jira_comment(task.external_id, comment)
            
            # Обновляем last_synced_at
            task.last_synced_at = timezone.now()
            task.save(update_fields=['last_synced_at'])
            
            return True
        
        except Exception as e:
            logger.error(f"Failed to update Jira status for {task.external_id}: {e}")
            return False
    
    async def _add_jira_comment(self, issue_key: str, comment: str):
        """Добавление комментария в Jira issue"""
        try:
            import asyncio
            await asyncio.to_thread(
                self.jira.add_comment,
                issue_key,
                comment
            )
            logger.info(f"Added comment to {issue_key}")
        except Exception as e:
            logger.error(f"Failed to add comment to {issue_key}: {e}")
    
    def _get_weu_task_url(self, task_id: int) -> str:
        """Получить URL задачи в WEU"""
        # TODO: использовать настоящий домен из settings
        base_url = os.getenv("WEU_BASE_URL", "http://localhost:8000")
        return f"{base_url}/tasks/?task_id={task_id}"
    
    async def sync_status_to_jira(self, task) -> bool:
        """
        Синхронизация статуса задачи из WEU в Jira
        
        Args:
            task: tasks.models.Task instance
        """
        if not self.available or not task.sync_back:
            return False
        
        if task.external_system != 'jira' or not task.external_id:
            return False
        
        try:
            issue = self.jira.issue(task.external_id)
            
            # Маппинг статусов WEU -> Jira
            status_map = {
                'TODO': 'To Do',
                'IN_PROGRESS': 'In Progress',
                'DONE': 'Done',
                'BLOCKED': 'Blocked',
                'CANCELLED': 'Cancelled',
            }
            
            target_status = status_map.get(task.status)
            if not target_status:
                return False
            
            # Получаем доступные transitions
            transitions = self.jira.transitions(issue)
            target_transition = next(
                (t for t in transitions if target_status.lower() in t['name'].lower()),
                None
            )
            
            if target_transition:
                self.jira.transition_issue(issue, target_transition['id'])
                logger.info(f"Synced status for {task.external_id}: {target_status}")
                
                task.last_synced_at = timezone.now()
                task.save(update_fields=['last_synced_at'])
                return True
            else:
                logger.warning(f"No transition to '{target_status}' found for {task.external_id}")
                return False
        
        except Exception as e:
            logger.error(f"Failed to sync status to Jira: {e}")
            return False
    
    def get_project_issues(self, project_key: str, max_results: int = 100) -> List:
        """Получить issues проекта"""
        if not self.available:
            return []
        
        try:
            jql = f'project = {project_key} ORDER BY created DESC'
            issues = self.jira.search_issues(jql, maxResults=max_results)
            return issues
        except Exception as e:
            logger.error(f"Failed to get project issues: {e}")
            return []
    
    def get_user_issues(self, username: str = None) -> List:
        """Получить issues пользователя"""
        if not self.available:
            return []
        
        try:
            if username:
                jql = f'assignee = {username} AND resolution = Unresolved ORDER BY created DESC'
            else:
                jql = 'assignee = currentUser() AND resolution = Unresolved ORDER BY created DESC'
            
            issues = self.jira.search_issues(jql, maxResults=50)
            return issues
        except Exception as e:
            logger.error(f"Failed to get user issues: {e}")
            return []
    
    def test_connection(self) -> Dict[str, Any]:
        """Тестирование подключения к Jira"""
        if not self.available:
            return {
                'success': False,
                'error': 'Jira not configured'
            }
        
        try:
            # Простой запрос для проверки
            myself = self.jira.myself()
            
            return {
                'success': True,
                'user': myself.get('displayName'),
                'email': myself.get('emailAddress'),
                'server': self.jira_url
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }


# Global Jira connector instance
_jira_connector = None


def get_jira_connector() -> JiraConnector:
    """Get or create global Jira connector instance"""
    global _jira_connector
    if _jira_connector is None:
        _jira_connector = JiraConnector()
    return _jira_connector
