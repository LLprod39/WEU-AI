"""
Filesystem Tools for File Operations
"""
import os
import aiofiles
from pathlib import Path
from loguru import logger
from typing import Optional
from app.tools.base import BaseTool, ToolMetadata, ToolParameter


class ReadFileTool(BaseTool):
    """Read file contents"""
    
    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="read_file",
            description="Read contents of a file",
            category="filesystem",
            parameters=[
                ToolParameter(name="path", type="string", description="Path to file"),
            ]
        )
    
    async def execute(self, path: str) -> str:
        """Read file"""
        try:
            async with aiofiles.open(path, mode='r', encoding='utf-8') as f:
                content = await f.read()
            logger.info(f"Read file: {path}")
            return content
        except Exception as e:
            logger.error(f"Failed to read {path}: {e}")
            return f"Error reading file: {str(e)}"


class WriteFileTool(BaseTool):
    """Write content to file"""
    
    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="write_file",
            description="Write content to a file",
            category="filesystem",
            parameters=[
                ToolParameter(name="path", type="string", description="Path to file"),
                ToolParameter(name="content", type="string", description="Content to write"),
            ]
        )
    
    async def execute(self, path: str, content: str) -> str:
        """Write file"""
        try:
            # Create parent directories if needed
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            
            async with aiofiles.open(path, mode='w', encoding='utf-8') as f:
                await f.write(content)
            logger.info(f"Wrote file: {path}")
            return f"Successfully wrote to {path}"
        except Exception as e:
            logger.error(f"Failed to write {path}: {e}")
            return f"Error writing file: {str(e)}"


class ListDirectoryTool(BaseTool):
    """List directory contents"""
    
    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="list_directory",
            description="List contents of a directory",
            category="filesystem",
            parameters=[
                ToolParameter(name="path", type="string", description="Directory path"),
            ]
        )
    
    async def execute(self, path: str) -> str:
        """List directory"""
        try:
            items = os.listdir(path)
            result = "\n".join(items)
            logger.info(f"Listed directory: {path}")
            return result
        except Exception as e:
            logger.error(f"Failed to list {path}: {e}")
            return f"Error listing directory: {str(e)}"


class CreateDirectoryTool(BaseTool):
    """Create a new directory"""
    
    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="create_directory",
            description="Create a new directory",
            category="filesystem",
            parameters=[
                ToolParameter(name="path", type="string", description="Directory path to create"),
            ]
        )
    
    async def execute(self, path: str) -> str:
        """Create directory"""
        try:
            Path(path).mkdir(parents=True, exist_ok=True)
            logger.info(f"Created directory: {path}")
            return f"Successfully created directory: {path}"
        except Exception as e:
            logger.error(f"Failed to create {path}: {e}")
            return f"Error creating directory: {str(e)}"


class DeleteFileTool(BaseTool):
    """Delete a file"""
    
    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name="delete_file",
            description="Delete a file",
            category="filesystem",
            parameters=[
                ToolParameter(name="path", type="string", description="File path to delete"),
            ]
        )
    
    async def execute(self, path: str) -> str:
        """Delete file"""
        try:
            os.remove(path)
            logger.info(f"Deleted file: {path}")
            return f"Successfully deleted: {path}"
        except Exception as e:
            logger.error(f"Failed to delete {path}: {e}")
            return f"Error deleting file: {str(e)}"
