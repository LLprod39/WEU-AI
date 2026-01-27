"""
Исполнитель задач
Автоматически выполняет задачи на серверах через ИИ-агентов
"""
import asyncio
from typing import Dict, Any, Optional
from django.contrib.auth.models import User
from django.utils import timezone
from loguru import logger

from .models import Task, TaskExecution, SubTask
from servers.models import Server
from passwords.encryption import PasswordEncryption
from app.tools.ssh_tools import ssh_manager
from app.agents.manager import get_agent_manager
from app.core.orchestrator import Orchestrator


class TaskExecutor:
    """Исполнитель задач на серверах"""
    
    def __init__(self):
        self.agent_manager = get_agent_manager()
    
    async def execute_task(self, task_id: int, user_id: int):
        """
        Выполнение задачи на сервере
        
        Args:
            task_id: ID задачи
            user_id: ID пользователя
        """
        try:
            task = Task.objects.get(id=task_id)
            user = User.objects.get(id=user_id)
            
            if not task.target_server:
                logger.error(f"Task {task_id} has no target server")
                return
            
            # Создаем или получаем запись о выполнении
            execution = TaskExecution.objects.filter(
                task=task,
                status__in=['PENDING', 'ANALYZING', 'PLANNING', 'EXECUTING']
            ).first()
            
            if not execution:
                execution = TaskExecution.objects.create(
                    task=task,
                    agent_type=task.ai_agent_type or 'react',
                    status='PENDING'
                )
            
            # Обновляем статус задачи
            task.status = 'IN_PROGRESS'
            task.ai_execution_status = 'EXECUTING'
            task.started_at = timezone.now()
            task.save()
            
            execution.status = 'EXECUTING'
            execution.started_at = timezone.now()
            execution.save()
            
            # Подключаемся к серверу
            server = task.target_server
            connection_id = await self._connect_to_server(server, user)
            
            if not connection_id:
                raise Exception("Не удалось подключиться к серверу")
            
            try:
                # Формируем задачу для агента
                agent_task = self._prepare_agent_task(task, server)
                
                # Выполняем через агента
                agent_type = task.ai_agent_type or 'react'
                result = await self._execute_with_agent(
                    agent_type,
                    agent_task,
                    connection_id,
                    task,
                    execution
                )
                
                # Сохраняем результат
                execution.status = 'COMPLETED'
                execution.completed_at = timezone.now()
                execution.result_summary = result.get('summary', 'Задача выполнена успешно')
                execution.execution_log = result.get('log', '')
                
                if execution.started_at:
                    duration = (execution.completed_at - execution.started_at).total_seconds() / 60
                    execution.actual_duration_minutes = int(duration)
                
                execution.save()
                
                # Обновляем задачу
                task.status = 'DONE'
                task.ai_execution_status = 'COMPLETED'
                task.completed_at = timezone.now()
                
                if task.started_at:
                    duration = (task.completed_at - task.started_at).total_seconds() / 3600
                    task.actual_duration_hours = duration
                
                task.save()
                
                logger.info(f"Task {task_id} completed successfully")
                
            finally:
                # Отключаемся от сервера
                try:
                    await ssh_manager.disconnect(connection_id)
                except Exception as e:
                    logger.warning(f"Error disconnecting from server: {e}")
        
        except Exception as e:
            logger.error(f"Error executing task {task_id}: {e}")
            
            # Обновляем статус на ошибку
            try:
                task = Task.objects.get(id=task_id)
                task.ai_execution_status = 'FAILED'
                task.status = 'BLOCKED'
                task.save()
                
                execution = TaskExecution.objects.filter(task=task).order_by('-created_at').first()
                if execution:
                    execution.status = 'FAILED'
                    execution.error_message = str(e)
                    execution.completed_at = timezone.now()
                    execution.save()
            except Exception as exc:
                logger.error(f"Error updating task status: {exc}")
    
    async def _connect_to_server(self, server: Server, user: User) -> Optional[str]:
        """Подключение к серверу"""
        try:
            # Получаем пароль
            password = None
            if server.auth_method in ['password', 'key_password']:
                # Для получения пароля нужен master_password
                # В реальном приложении это должно быть безопасно
                # Здесь упрощенная версия - нужно будет доработать
                logger.warning("Password decryption not fully implemented - needs master_password")
            
            # Подключаемся
            connection_id = await ssh_manager.connect(
                host=server.host,
                username=server.username,
                password=password,
                key_path=server.key_path if server.auth_method in ['key', 'key_password'] else None,
                port=server.port
            )
            
            # Обновляем время последнего подключения
            server.last_connected = timezone.now()
            server.save(update_fields=['last_connected'])
            
            return connection_id
        
        except Exception as e:
            logger.error(f"Error connecting to server {server.id}: {e}")
            return None
    
    def _prepare_agent_task(self, task: Task, server: Server) -> str:
        """Подготовка задачи для агента"""
        task_description = f"""
Задача: {task.title}

Описание:
{task.description}

Сервер: {server.name} ({server.host})
Пользователь: {server.username}

Выполни эту задачу на указанном сервере через SSH.
"""
        
        # Добавляем информацию о подзадачах
        subtasks = task.subtasks.all().order_by('order')
        if subtasks:
            task_description += "\n\nПодзадачи:\n"
            for idx, subtask in enumerate(subtasks, 1):
                status = "✓" if subtask.is_completed else "○"
                task_description += f"{idx}. {status} {subtask.title}\n"
        
        return task_description
    
    async def _execute_with_agent(
        self,
        agent_type: str,
        task_description: str,
        connection_id: str,
        task: Task,
        execution: TaskExecution
    ) -> Dict[str, Any]:
        """Выполнение задачи через агента"""
        try:
            # Получаем агента
            agent_manager = get_agent_manager()
            
            # Контекст для агента
            context = {
                'connection_id': connection_id,
                'server': {
                    'name': task.target_server.name,
                    'host': task.target_server.host,
                },
                'task_id': task.id,
            }
            
            # Выполняем через агента
            result = await agent_manager.execute_agent(
                agent_type,
                task_description,
                context
            )
            
            # Обновляем лог выполнения
            execution.execution_log = result.get('output', '') or result.get('result', '')
            execution.save()
            
            return {
                'summary': result.get('summary', 'Задача выполнена'),
                'log': execution.execution_log,
                'success': result.get('success', True)
            }
        
        except Exception as e:
            logger.error(f"Error executing with agent: {e}")
            raise
