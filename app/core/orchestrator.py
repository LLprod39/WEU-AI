"""
Enhanced Orchestrator with ReAct Loop and Full Tool Integration
Central brain of the agentic system
"""
from app.core.llm import LLMProvider
from app.rag.engine import RAGEngine
from app.tools.manager import ToolManager
from loguru import logger
import asyncio
import re
import json
from typing import AsyncGenerator, List, Dict, Any


class Orchestrator:
    """
    Central Orchestrator for the Agentic System.
    Implements ReAct (Reason + Act) pattern for intelligent task execution.
    
    Features:
    - Chat with RAG integration
    - Tool execution via ReAct loop
    - SSH operations
    - MCP server integration
    - Smart context management
    """
    
    def __init__(self):
        self.llm = LLMProvider()
        self.rag = RAGEngine()
        self.tool_manager = ToolManager()
        self.history: List[Dict[str, str]] = []
        self.max_iterations = 5  # Max ReAct loop iterations
        
    async def initialize(self):
        """
        Initialize the orchestrator and connect to external services
        """
        logger.info("Initializing Orchestrator...")
        
        # Example: Connect to MCP servers if needed
        # await self.tool_manager.connect_mcp_server_sse("filesystem", "http://localhost:8000/sse")
        
        logger.success("Orchestrator initialized")
    
    async def process_user_message(
        self, 
        message: str, 
        model_preference: str = None,
        use_rag: bool = True,
        specific_model: str = None,  # Allow specific model override
        user_id=None,  # For per-user RAG isolation
        initial_history: List[Dict[str, str]] = None  # История из БД для продолжения чата
    ) -> AsyncGenerator[str, None]:
        """
        Process user message with full ReAct loop
        
        Flow:
        1. Retrieve context from RAG (if enabled)
        2. Enter ReAct loop:
           - Reason: LLM decides what to do
           - Act: Execute tool if needed
           - Observe: Get tool result
           - Repeat or Finish
        3. Stream final response
        
        If initial_history is provided, it is used for context instead of self.history
        and self.history is not mutated (для поточных запросов с chat_id).
        """
        effective_history = list(initial_history) if initial_history else list(self.history)
        effective_history.append({"role": "user", "content": message})
        if not initial_history:
            self.history.append({"role": "user", "content": message})
        
        # Resolve model preference
        if not model_preference:
            from app.core.model_config import model_manager
            model_preference = model_manager.config.default_provider
        
        # Limit history to last 10 messages (for prompt)
        if len(effective_history) > 10:
            effective_history = effective_history[-10:]
        if not initial_history and len(self.history) > 10:
            self.history = self.history[-10:]
        
        # Step 1: Retrieve RAG context
        rag_context = ""
        if use_rag and self.rag.available and user_id is not None:
            try:
                results = self.rag.query(message, n_results=3, user_id=user_id)
                if results.get('documents') and results['documents'][0]:
                    docs = results['documents'][0]
                    if docs:
                        rag_context = "\n".join([f"📚 {doc}" for doc in docs])
                        logger.info(f"Retrieved {len(docs)} documents from RAG")
            except Exception as e:
                logger.warning(f"RAG query failed: {e}")
        
        # Step 2: ReAct Loop
        iteration = 0
        final_answer = ""
        
        while iteration < self.max_iterations:
            iteration += 1
            logger.info(f"ReAct iteration {iteration}/{self.max_iterations}")
            
            # Build system prompt (use effective_history when continuing saved chat)
            system_prompt = self._build_system_prompt(
                user_message=message,
                rag_context=rag_context,
                iteration=iteration,
                history_override=effective_history if initial_history else None
            )
            
            # Get LLM response
            llm_response = ""
            async for chunk in self.llm.stream_chat(
                system_prompt, 
                model=model_preference,
                specific_model=specific_model
            ):
                llm_response += chunk
                # Stream thinking process to user (optional - can be disabled for cleaner UX)
                if iteration == 1:  # Only show first iteration thinking
                    yield chunk
            
            # Parse response for actions
            action_match = self._parse_action(llm_response)
            
            if action_match:
                # Agent wants to use a tool
                tool_name = action_match['tool']
                tool_args = action_match['args']
                
                yield f"\n\n🔧 **Using tool: {tool_name}**\n"
                
                try:
                    # Execute tool
                    result = await self.tool_manager.execute_tool(tool_name, **tool_args)
                    
                    # Format result
                    result_str = self._format_tool_result(result)
                    yield f"✅ **Result:**\n```\n{result_str}\n```\n\n"
                    
                    # Add to effective history (and self.history if not override)
                    effective_history.append({
                        "role": "assistant",
                        "content": f"ACTION: {tool_name} with {tool_args}"
                    })
                    effective_history.append({
                        "role": "system",
                        "content": f"OBSERVATION: {result_str}"
                    })
                    if not initial_history:
                        self.history.append({
                            "role": "assistant",
                            "content": f"ACTION: {tool_name} with {tool_args}"
                        })
                        self.history.append({
                            "role": "system",
                            "content": f"OBSERVATION: {result_str}"
                        })
                    
                    # Continue loop with new observation
                    continue
                    
                except Exception as e:
                    error_msg = f"❌ Tool execution failed: {str(e)}"
                    yield f"{error_msg}\n\n"
                    logger.error(error_msg)
                    
                    effective_history.append({
                        "role": "system",
                        "content": f"ERROR: {str(e)}"
                    })
                    if not initial_history:
                        self.history.append({
                            "role": "system",
                            "content": f"ERROR: {str(e)}"
                        })
                    
                    # Continue loop to let agent handle error
                    continue
            else:
                # No action - this is the final answer
                final_answer = llm_response
                break
        
        # If we exhausted iterations without final answer, use last response
        if not final_answer:
            final_answer = "I've reached my iteration limit. Here's what I found so far:\n\n" + llm_response
        
        # Add final answer to history
        effective_history.append({"role": "assistant", "content": final_answer})
        if not initial_history:
            self.history.append({"role": "assistant", "content": final_answer})
        
        # Add to RAG if it's valuable information
        if len(final_answer) > 100 and user_id is not None:  # Only add substantial responses
            try:
                self.rag.add_text(
                    f"Q: {message}\nA: {final_answer}",
                    source="conversation",
                    user_id=user_id
                )
            except Exception as e:
                logger.warning(f"Failed to add to RAG: {e}")
        
        # If we already streamed the answer (iteration 1), don't stream again
        if iteration > 1:
            yield f"\n\n{final_answer}"
    
    def _build_system_prompt(
        self, user_message: str, rag_context: str, iteration: int,
        history_override: List[Dict[str, str]] = None
    ) -> str:
        """Build the ReAct system prompt. history_override uses saved chat history when continuing a session."""
        
        tools_description = self.tool_manager.get_tools_description()
        history_source = history_override if history_override is not None else self.history
        
        history_text = ""
        if len(history_source) > 1:
            # Show last few exchanges
            recent = history_source[-6:]
            history_text = "\n".join([
                f"{msg['role'].upper()}: {msg['content'][:200]}" 
                for msg in recent[:-1]  # Exclude current message
            ])
        
        prompt = f"""You are WEU Agent - an intelligent assistant with access to various tools.

{tools_description}

KNOWLEDGE BASE CONTEXT:
{rag_context if rag_context else "No relevant context found."}

CONVERSATION HISTORY:
{history_text if history_text else "No previous context."}

INSTRUCTIONS:
1. Think step-by-step about the user's request
2. If you can answer directly, just provide the answer
3. If you need to use a tool, format your response EXACTLY like this:

THOUGHT: [Your reasoning about what tool to use and why]
ACTION: tool_name {{"param1": "value1", "param2": "value2"}}

4. After a tool executes, you'll see OBSERVATION with the result
5. Then continue thinking and either use another tool or provide final answer
6. When you have the final answer, just respond normally without ACTION

IMPORTANT:
- Use tools when you need to: search web, read/write files, connect to SSH, etc.
- The ACTION line must be valid JSON for parameters
- Only use tools that are listed above
- Be concise and helpful

USER REQUEST: {user_message}

Your response:"""
        
        return prompt
    
    def _parse_action(self, response: str) -> dict:
        """
        Parse action from LLM response
        Returns: {"tool": "tool_name", "args": {dict}} or None
        """
        # Look for ACTION: tool_name {json}
        pattern = r'ACTION:\s*(\w+)\s*(\{.*?\})'
        match = re.search(pattern, response, re.DOTALL)
        
        if match:
            tool_name = match.group(1)
            args_str = match.group(2)
            
            try:
                args = json.loads(args_str)
                return {"tool": tool_name, "args": args}
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse action arguments: {e}")
                return None
        
        return None
    
    def _format_tool_result(self, result: Any) -> str:
        """Format tool execution result for display"""
        if isinstance(result, dict):
            return json.dumps(result, indent=2, ensure_ascii=False)
        elif isinstance(result, str):
            return result
        else:
            return str(result)
    
    def get_available_tools(self) -> List[Dict]:
        """Get list of all available tools"""
        return [tool.to_dict() for tool in self.tool_manager.get_all_tools()]
    
    def clear_history(self):
        """Clear conversation history"""
        self.history = []
        logger.info("Conversation history cleared")
    
    async def add_to_knowledge_base(self, text: str, source: str = "manual", user_id=None):
        """Add text to RAG knowledge base (user_id required for per-user isolation)."""
        if self.rag.available and user_id is not None:
            doc_id = self.rag.add_text(text, source, user_id=user_id)
            logger.info(f"Added to knowledge base: {doc_id}")
            return doc_id
        else:
            logger.warning("RAG not available or user_id missing")
            return None
