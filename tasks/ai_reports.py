"""
AI Reports Generator for Tasks
"""
from typing import List, Dict
from loguru import logger
from app.core.llm import LLMProvider
from app.core.model_config import model_manager
from asgiref.sync import async_to_sync


class TaskReportGenerator:
    """Generate various reports about tasks"""
    
    def __init__(self):
        self.llm = LLMProvider()
    
    async def weekly_report(self, tasks: List[Dict]) -> str:
        """Generate weekly progress report"""
        try:
            model = model_manager.config.default_provider
            
            # Categorize tasks
            completed = [t for t in tasks if t.get('status') == 'DONE']
            in_progress = [t for t in tasks if t.get('status') == 'IN_PROGRESS']
            todo = [t for t in tasks if t.get('status') == 'TODO']
            blocked = [t for t in tasks if t.get('status') == 'BLOCKED']
            
            prompt = f"""Generate a weekly progress report for the following tasks:

Completed ({len(completed)}):
{chr(10).join([f"- {t.get('title', 'Untitled')}" for t in completed])}

In Progress ({len(in_progress)}):
{chr(10).join([f"- {t.get('title', 'Untitled')}" for t in in_progress])}

To Do ({len(todo)}):
{chr(10).join([f"- {t.get('title', 'Untitled')}" for t in todo])}

Blocked ({len(blocked)}):
{chr(10).join([f"- {t.get('title', 'Untitled')}" for t in blocked])}

Provide a comprehensive weekly report with:
1. Summary of achievements
2. Current status
3. Challenges and blockers
4. Next week priorities
5. Recommendations"""
            
            response_text = ""
            async for chunk in self.llm.stream_chat(prompt, model=model):
                response_text += chunk
            
            return response_text.strip()
            
        except Exception as e:
            logger.error(f"Weekly report generation failed: {e}")
            return f"Error generating weekly report: {str(e)}"
    
    async def priority_analysis(self, tasks: List[Dict]) -> str:
        """Analyze task priorities and provide recommendations"""
        try:
            model = model_manager.config.default_provider
            
            tasks_info = "\n".join([
                f"- {t.get('title', 'Untitled')}: Priority={t.get('priority', 'MEDIUM')}, Status={t.get('status', 'TODO')}"
                for t in tasks
            ])
            
            prompt = f"""Analyze the priorities of the following tasks and provide recommendations:

Tasks:
{tasks_info}

Provide:
1. Priority distribution analysis
2. Tasks that may need reprioritization
3. Recommendations for better priority management"""
            
            response_text = ""
            async for chunk in self.llm.stream_chat(prompt, model=model):
                response_text += chunk
            
            return response_text.strip()
            
        except Exception as e:
            logger.error(f"Priority analysis failed: {e}")
            return f"Error analyzing priorities: {str(e)}"


# Sync wrappers
def weekly_report_sync(tasks: List[Dict]) -> str:
    """Synchronous wrapper"""
    generator = TaskReportGenerator()
    return async_to_sync(generator.weekly_report)(tasks)


def priority_analysis_sync(tasks: List[Dict]) -> str:
    """Synchronous wrapper"""
    generator = TaskReportGenerator()
    return async_to_sync(generator.priority_analysis)(tasks)
