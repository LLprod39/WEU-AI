"""
CLI runtime integration for Cursor, OpenCode, and Gemini CLI.
"""
import asyncio
import shlex
from dataclasses import dataclass
from typing import Dict, Any, List
import os
from django.conf import settings
from loguru import logger


@dataclass
class CliRunResult:
    success: bool
    output: str
    logs: str
    meta: Dict[str, Any]


class CliRuntimeManager:
    """Unified runner for CLI-based agents"""

    def __init__(self):
        self.config = getattr(settings, "CLI_RUNTIME_CONFIG", {})

    def _get_runtime(self, runtime: str) -> Dict[str, Any]:
        return self.config.get(runtime, {})

    async def run(self, runtime: str, task: str, config: Dict[str, Any], mcp_config: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Run CLI command once or in a Ralph-like loop if enabled.

        Args:
            runtime: CLI runtime (cursor, claude)
            task: Task description
            config: Runtime configuration
            mcp_config: MCP servers configuration (per-agent)

        Note: "ralph" is not a CLI runtime. It's an internal orchestration pattern.
              Use cursor/claude with use_ralph_loop=True instead.
        """
        if runtime == "ralph":
            # Ralph is not a CLI - it's an orchestration pattern
            # Fall back to cursor with ralph loop enabled
            logger.warning("runtime='ralph' is deprecated. Using 'cursor' with ralph loop instead.")
            runtime = "cursor"
            config = {**config, "use_ralph_loop": True}
            if not config.get("completion_promise"):
                config["completion_promise"] = "COMPLETE"

        use_ralph_loop = bool(config.get("use_ralph_loop"))
        max_iterations = config.get("max_iterations", 1)
        completion_promise = (config.get("completion_promise") or "").strip()
        include_previous = config.get("loop_include_previous", True)

        if use_ralph_loop:
            if isinstance(max_iterations, str) and max_iterations.isdigit():
                max_iterations = int(max_iterations)
            if max_iterations <= 0:
                max_iterations = 20

            combined_output = []
            combined_logs = []
            last_output = ""
            for i in range(1, max_iterations + 1):
                iteration_task = task
                if include_previous and i > 1:
                    iteration_task = (
                        "Продолжай работу по задаче. Проверь предыдущий вывод и улучши результат.\n\n"
                        f"Изначальная задача:\n{task}\n\n"
                        f"Предыдущий вывод:\n{last_output}\n\n"
                        f"Если все готово, выведи <promise>{completion_promise}</promise>."
                    )
                result = await self._run_once(runtime, iteration_task, config)
                combined_output.append(f"Iteration {i}:\n{result['output']}")
                combined_logs.append(result.get("logs", ""))
                last_output = result.get("output", "")

                if completion_promise and self._has_completion_promise(result["output"], completion_promise):
                    return {
                        "success": True,
                        "output": "\n\n".join(combined_output),
                        "logs": "\n".join(combined_logs),
                        "meta": {"iterations": i, "completed": True},
                    }

            return {
                "success": True,
                "output": "\n\n".join(combined_output),
                "logs": "\n".join(combined_logs),
                "meta": {"iterations": max_iterations, "completed": False},
            }

        return await self._run_once(runtime, task, config)

    async def _run_once(self, runtime: str, task: str, config: Dict[str, Any], mcp_config: Dict[str, Any] = None) -> Dict[str, Any]:
        runtime_cfg = self._get_runtime(runtime)
        if not runtime_cfg:
            raise ValueError(f"Runtime '{runtime}' is not configured")

        command_template = runtime_cfg.get("command")
        if not command_template:
            raise ValueError(f"Runtime '{runtime}' missing command template")

        args_template = runtime_cfg.get("args", [])
        args_template = [self._format_arg(runtime_cfg, arg) for arg in args_template]
        prompt_style = runtime_cfg.get("prompt_style", "flag")
        allowed_args = runtime_cfg.get("allowed_args", [])
        
        # Setup MCP if provided
        mcp_config_file = None
        if mcp_config and runtime in ["cursor", "claude"]:
            from app.core.mcp_manager import get_mcp_manager
            mcp_manager = get_mcp_manager()
            mcp_config_file = mcp_manager.create_mcp_config_file(mcp_config)

        # Build args from config: only allow whitelisted keys
        cli_args = []
        for arg_name in allowed_args:
            value = None
            if arg_name in config:
                value = config[arg_name]
            else:
                underscore_key = arg_name.replace("-", "_")
                if underscore_key in config:
                    value = config[underscore_key]

            if value not in (None, "", []):
                if isinstance(value, bool):
                    if value:
                        cli_args.append(f"--{arg_name}")
                    # для False флаг не передаём
                else:
                    cli_args.extend([f"--{arg_name}", str(value)])

        # Append task as final prompt argument
        full_args = list(args_template) + cli_args
        if prompt_style == "positional":
            full_args += [task]
        else:
            full_args += [task]

        cmd = [self._resolve_command(runtime_cfg, command_template)] + full_args
        logger.info(f"Running CLI runtime: {runtime} -> {' '.join(shlex.quote(c) for c in cmd)}")

        subprocess_env = None
        if runtime == "cursor":
            # Headless: CURSOR_API_KEY из .env — без входа по Google. Ключ: Cursor → Settings → API Access.
            subprocess_env = dict(os.environ)
            extra = getattr(settings, "CURSOR_CLI_EXTRA_ENV", None) or {}
            subprocess_env.update(extra)
            
            # MCP config file для Cursor
            if mcp_config_file:
                subprocess_env['MCP_CONFIG_PATH'] = mcp_config_file
        
        elif runtime == "claude":
            subprocess_env = dict(os.environ)
            
            # MCP config file для Claude
            if mcp_config_file:
                # Claude использует переменную MCP_CONFIG или .cursor/mcp.json
                subprocess_env['MCP_CONFIG_PATH'] = mcp_config_file

        create_kw = {"stdout": asyncio.subprocess.PIPE, "stderr": asyncio.subprocess.PIPE}
        if subprocess_env is not None:
            create_kw["env"] = subprocess_env
        process = await asyncio.create_subprocess_exec(*cmd, **create_kw)
        timeout_seconds = runtime_cfg.get("timeout_seconds") or getattr(settings, "CLI_RUNTIME_TIMEOUT_SECONDS", 600)
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            process.kill()
            await process.communicate()
            return {
                "success": False,
                "output": "",
                "logs": f"Timeout after {timeout_seconds} seconds",
                "meta": {"exit_code": -1, "timeout": True, "pid": process.pid},
            }
        stdout = stdout_bytes.decode("utf-8", errors="ignore")
        stderr = stderr_bytes.decode("utf-8", errors="ignore")

        return {
            "success": process.returncode == 0,
            "output": stdout.strip(),
            "logs": stderr.strip(),
            "meta": {"exit_code": process.returncode, "pid": process.pid},
        }

    @staticmethod
    def _has_completion_promise(output: str, promise: str) -> bool:
        import re

        match = re.search(r"<promise>(.*?)</promise>", output, re.DOTALL | re.IGNORECASE)
        if not match:
            return False
        extracted = re.sub(r"\s+", " ", match.group(1).strip())
        target = re.sub(r"\s+", " ", promise.strip())
        return extracted == target

    def _resolve_command(self, runtime_cfg: Dict[str, Any], command_template: str) -> str:
        return command_template

    def _format_arg(self, runtime_cfg: Dict[str, Any], arg: str) -> str:
        if arg != "{workspace}":
            return arg
        return str(getattr(settings, "BASE_DIR", ""))
