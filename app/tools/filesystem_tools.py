"""
Filesystem Tools for File Operations
"""
import os
import aiofiles
from pathlib import Path
from loguru import logger
from typing import Optional, Dict, Any
from app.tools.base import BaseTool, ToolMetadata, ToolParameter


def _resolve_path(path: str, _context: Optional[Dict[str, Any]] = None) -> str:
    """
    Разрешает путь относительно workspace_path если он есть в _context.
    
    Args:
        path: путь к файлу/директории (может быть относительным или абсолютным)
        _context: контекст выполнения (может содержать workspace_path)
        
    Returns:
        Абсолютный путь
        
    Raises:
        ValueError: если разрешённый путь выходит за пределы workspace_path
    """
    workspace_path = None
    if _context:
        workspace_path = _context.get("workspace_path")
    
    # Если путь абсолютный или нет workspace_path, возвращаем как есть
    if os.path.isabs(path) or not workspace_path:
        return path
    
    # Разрешаем относительный путь относительно workspace
    resolved = os.path.normpath(os.path.join(workspace_path, path))
    
    # Проверяем безопасность: итоговый путь должен быть внутри workspace_path
    try:
        resolved_abs = os.path.abspath(resolved)
        workspace_abs = os.path.abspath(workspace_path)
        
        # Нормализуем пути для сравнения (убираем trailing slashes)
        resolved_abs = os.path.normpath(resolved_abs)
        workspace_abs = os.path.normpath(workspace_abs)
        
        # Проверка через startswith (работает на всех платформах)
        if not resolved_abs.startswith(workspace_abs):
            raise ValueError(f"Path {path} resolves outside workspace {workspace_path}")
        
        # Дополнительная проверка: следующий символ должен быть разделителем или концом строки
        if len(resolved_abs) > len(workspace_abs):
            next_char = resolved_abs[len(workspace_abs)]
            if next_char not in (os.sep, os.altsep if os.altsep else ''):
                raise ValueError(f"Path {path} resolves outside workspace {workspace_path}")
    except (ValueError, OSError) as e:
        if isinstance(e, ValueError):
            raise
        # Для OSError просто возвращаем resolved
        pass
    
    return resolved


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
    
    async def execute(self, path: str, _context: Optional[Dict[str, Any]] = None) -> str:
        """Read file"""
        try:
            resolved_path = _resolve_path(path, _context)
            async with aiofiles.open(resolved_path, mode='r', encoding='utf-8') as f:
                content = await f.read()
            logger.info(f"Read file: {resolved_path}")
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
    
    async def execute(self, path: str, content: str, _context: Optional[Dict[str, Any]] = None) -> str:
        """Write file"""
        try:
            resolved_path = _resolve_path(path, _context)
            # Create parent directories if needed
            Path(resolved_path).parent.mkdir(parents=True, exist_ok=True)
            
            async with aiofiles.open(resolved_path, mode='w', encoding='utf-8') as f:
                await f.write(content)
            logger.info(f"Wrote file: {resolved_path}")
            return f"Successfully wrote to {resolved_path}"
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
    
    async def execute(self, path: str, _context: Optional[Dict[str, Any]] = None) -> str:
        """List directory"""
        try:
            resolved_path = _resolve_path(path, _context)
            items = os.listdir(resolved_path)
            result = "\n".join(items)
            logger.info(f"Listed directory: {resolved_path}")
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
    
    async def execute(self, path: str, _context: Optional[Dict[str, Any]] = None) -> str:
        """Create directory"""
        try:
            resolved_path = _resolve_path(path, _context)
            Path(resolved_path).mkdir(parents=True, exist_ok=True)
            logger.info(f"Created directory: {resolved_path}")
            return f"Successfully created directory: {resolved_path}"
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
                ToolParameter(
                    name="allow_delete",
                    type="boolean",
                    description="Разрешить удаление (только при явном подтверждении пользователя)",
                    required=False,
                ),
            ]
        )
    
    async def execute(self, path: str, allow_delete: bool = False, _context: Optional[Dict[str, Any]] = None) -> str:
        """Delete file"""
        if not allow_delete:
            return "Удаление запрещено без явного подтверждения (allow_delete=true)."
        try:
            resolved_path = _resolve_path(path, _context)
            os.remove(resolved_path)
            logger.info(f"Deleted file: {resolved_path}")
            return f"Successfully deleted: {resolved_path}"
        except Exception as e:
            logger.error(f"Failed to delete {path}: {e}")
            return f"Error deleting file: {str(e)}"
