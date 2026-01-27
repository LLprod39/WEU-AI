import json
from app.core.llm import LLMProvider

async def improve_task_description(title, description):
    llm = LLMProvider()
    prompt = f"""
    You are a professional project manager. Improve the following task description to be more clear, actionable, and professional.
    
    Task Title: {title}
    Current Description: {description}
    
    Return only the improved description as plain text. Do not add any conversational filler.
    """
    
    response_text = ""
    from app.core.model_config import model_manager
    default_provider = model_manager.config.default_provider
    async for chunk in llm.stream_chat(prompt, model=default_provider):
        response_text += chunk
        
    return response_text

async def breakdown_task(title, description):
    llm = LLMProvider()
    prompt = f"""
    You are a professional project manager. Break down the following task into smaller, actionable subtasks.
    
    Task Title: {title}
    Description: {description}
    
    Return the subtasks as a JSON list of strings. Example: ["Subtask 1", "Subtask 2"]
    Do not add markdown formatting or any other text.
    """
    
    response_text = ""
    from app.core.model_config import model_manager
    default_provider = model_manager.config.default_provider
    async for chunk in llm.stream_chat(prompt, model=default_provider):
        response_text += chunk
        
    try:
        # Clean up potential markdown code blocks
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0].strip()
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0].strip()
            
        subtasks = json.loads(response_text)
        return subtasks
    except json.JSONDecodeError:
        return []
