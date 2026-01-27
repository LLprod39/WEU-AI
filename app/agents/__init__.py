"""
Agents package - various AI agents for task execution
"""
from app.agents.manager import AgentManager, get_agent_manager
from app.agents.base_agent import BaseAgent
from app.agents.react_agent import ReActAgent
from app.agents.simple_agent import SimpleAgent
from app.agents.complex_agent import ComplexAgent
from app.agents.ralph_agent import RalphWiggumAgent

__all__ = [
    'AgentManager',
    'get_agent_manager',
    'BaseAgent',
    'ReActAgent',
    'SimpleAgent',
    'ComplexAgent',
    'RalphWiggumAgent',
]
