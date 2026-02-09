"""
Agent Manager - manages all available agents
"""
from typing import Dict, List, Optional
from loguru import logger
from app.agents.base_agent import BaseAgent
from app.agents.react_agent import ReActAgent
from app.agents.simple_agent import SimpleAgent
from app.agents.complex_agent import ComplexAgent
from app.agents.ralph_agent import RalphWiggumAgent
from app.agents.claude_code_agent import ClaudeCodeAgent


class AgentManager:
    """
    Manages all available agents in the system.
    Provides registration, discovery, and execution of agents.
    """
    
    def __init__(self):
        self.agents: Dict[str, BaseAgent] = {}
        self._register_builtin_agents()
        self._agent_type_map = {
            "simple": "Simple Agent",
            "complex": "Complex Agent",
            "react": "ReAct Agent",
            "ralph": "Ralph Wiggum Agent",
            "claude_code": "Claude Code Agent",
        }
    
    def _register_builtin_agents(self):
        """Register all built-in agents"""
        builtin_agents = [
            ReActAgent(),
            SimpleAgent(),
            ComplexAgent(),
            RalphWiggumAgent(),
            ClaudeCodeAgent(),
        ]
        
        for agent in builtin_agents:
            self.register_agent(agent)
    
    def register_agent(self, agent: BaseAgent):
        """Register an agent"""
        name = agent.name
        if name in self.agents:
            logger.warning(f"Agent '{name}' already registered, overwriting")
        
        self.agents[name] = agent
        logger.info(f"Registered agent: {name}")
    
    def get_agent(self, name: str) -> Optional[BaseAgent]:
        """Get an agent by name"""
        return self.agents.get(name)

    def resolve_agent_name(self, agent_type_or_name: str) -> str:
        """Resolve agent name from a type or return the name as-is."""
        if not agent_type_or_name:
            return "ReAct Agent"
        if agent_type_or_name in self.agents:
            return agent_type_or_name
        return self._agent_type_map.get(agent_type_or_name, agent_type_or_name)
    
    def get_all_agents(self) -> List[BaseAgent]:
        """Get all registered agents"""
        return list(self.agents.values())
    
    def get_agent_info(self, name: str) -> Optional[Dict]:
        """Get agent information"""
        agent = self.get_agent(name)
        if agent:
            return agent.get_info()
        return None
    
    def list_agents(self) -> List[Dict]:
        """List all agents with their information"""
        return [agent.get_info() for agent in self.agents.values()]
    
    async def execute_agent(self, agent_name: str, task: str, context: Optional[Dict] = None) -> Dict:
        """
        Execute an agent with a task.
        
        Args:
            agent_name: Name of the agent to execute
            task: Task description
            context: Optional context dictionary
            
        Returns:
            Execution result dictionary
        """
        agent = self.get_agent(agent_name)
        if not agent:
            resolved = self.resolve_agent_name(agent_name)
            if resolved != agent_name:
                agent_name = resolved
                agent = self.get_agent(agent_name)
        if not agent:
            return {
                'success': False,
                'result': None,
                'error': f"Agent '{agent_name}' not found",
                'metadata': {}
            }
        
        try:
            logger.info(f"Executing agent '{agent_name}' with task: {task[:100]}...")
            result = await agent.execute(task, context)
            return result
        except Exception as e:
            logger.error(f"Error executing agent '{agent_name}': {e}")
            return {
                'success': False,
                'result': None,
                'error': str(e),
                'metadata': {'agent': agent_name}
            }


# Global agent manager instance
_agent_manager = None

def get_agent_manager() -> AgentManager:
    """Get or create global agent manager instance"""
    global _agent_manager
    if _agent_manager is None:
        _agent_manager = AgentManager()
    return _agent_manager
