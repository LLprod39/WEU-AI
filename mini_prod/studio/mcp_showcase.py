from __future__ import annotations

import json
import os
from pathlib import Path

from django.utils import timezone

from .models import MCPServerPool, Pipeline, PipelineRun
from .pipeline_executor import PipelineExecutor

DEMO_SERVER_NAME = "Studio Local MCP Demo"
DEMO_PIPELINE_NAME = "MCP Workspace Forge"
DEMO_ARTIFACT_PLAN = ".tmp_mcp_demo/mcp_workspace_forge_plan.md"
DEMO_ARTIFACT_MANIFEST = ".tmp_mcp_demo/mcp_workspace_forge_manifest.json"
DEMO_SERVER_URL = os.getenv("STUDIO_MCP_DEMO_URL", "http://127.0.0.1:8765/mcp")


def demo_server_script_path() -> Path:
    return Path(__file__).resolve().with_name("demo_mcp_server.py")


def ensure_demo_mcp_server(user) -> MCPServerPool:
    server, _ = MCPServerPool.objects.update_or_create(
        owner=user,
        name=DEMO_SERVER_NAME,
        defaults={
            "description": "Self-contained local HTTP MCP server for Studio validation (Docker-friendly).",
            "transport": MCPServerPool.TRANSPORT_SSE,
            "command": "",
            "args": [],
            "env": {},
            "url": DEMO_SERVER_URL,
            "is_shared": False,
        },
    )
    return server


def _json_payload(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def build_showcase_nodes(mcp_server_id: int) -> list[dict]:
    objective = (
        "Create a local MCP validation pack for Studio, write real workspace artifacts, "
        "and show that the MCP nodes can inspect, generate, persist, and verify outputs."
    )
    return [
        {
            "id": "start_manual",
            "type": "trigger/manual",
            "position": {"x": 620, "y": 20},
            "data": {"label": "Run MCP Forge", "is_active": True},
        },
        {
            "id": "scan_workspace",
            "type": "agent/mcp_call",
            "position": {"x": 250, "y": 180},
            "data": {
                "label": "MCP: Workspace Snapshot",
                "mcp_server_id": mcp_server_id,
                "tool_name": "workspace_snapshot",
                "arguments_text": _json_payload({"root": ".", "max_files": 2500}),
                "on_failure": "abort",
            },
        },
        {
            "id": "scan_todos",
            "type": "agent/mcp_call",
            "position": {"x": 710, "y": 180},
            "data": {
                "label": "MCP: TODO Scan",
                "mcp_server_id": mcp_server_id,
                "tool_name": "todo_scan",
                "arguments_text": _json_payload({"root": ".", "max_matches": 40}),
                "on_failure": "abort",
            },
        },
        {
            "id": "ai_brief",
            "type": "agent/llm_query",
            "position": {"x": 1160, "y": 180},
            "data": {
                "label": "Model: Optional AI Brief",
                "provider": "openai",
                "model": "gpt-5-mini",
                "system_prompt": "Turn repository findings into a concise execution brief.",
                "prompt": (
                    "You are preparing a short execution brief for a Studio MCP pipeline.\n\n"
                    "Workspace summary:\n{scan_workspace_output}\n\n"
                    "TODO scan:\n{scan_todos_output}\n\n"
                    "Write 5 concise bullets and end with a line `AI_SIGNAL: READY`."
                ),
                "include_all_outputs": False,
                "on_failure": "continue",
            },
        },
        {
            "id": "compose_plan",
            "type": "agent/mcp_call",
            "position": {"x": 500, "y": 390},
            "data": {
                "label": "MCP: Build Action Cards",
                "mcp_server_id": mcp_server_id,
                "tool_name": "build_action_cards",
                "arguments_text": _json_payload(
                    {
                        "objective": objective,
                        "workspace_summary": "{scan_workspace_output}",
                        "todo_summary": "{scan_todos_output}",
                        "ai_brief": "{ai_brief_output}",
                    }
                ),
                "on_failure": "abort",
            },
        },
        {
            "id": "compose_manifest",
            "type": "agent/mcp_call",
            "position": {"x": 1000, "y": 390},
            "data": {
                "label": "MCP: Compose Manifest",
                "mcp_server_id": mcp_server_id,
                "tool_name": "compose_manifest",
                "arguments_text": _json_payload(
                    {
                        "objective": objective,
                        "workspace_summary": "{scan_workspace_output}",
                        "todo_summary": "{scan_todos_output}",
                        "action_plan": "{compose_plan_output}",
                        "ai_brief": "{ai_brief_output}",
                    }
                ),
                "on_failure": "abort",
            },
        },
        {
            "id": "todo_flag",
            "type": "logic/condition",
            "position": {"x": 130, "y": 410},
            "data": {
                "label": "TODO Hotspot?",
                "source_node_id": "scan_todos",
                "check_type": "contains",
                "check_value": "HOTSPOT: yes",
            },
        },
        {
            "id": "write_plan",
            "type": "agent/mcp_call",
            "position": {"x": 430, "y": 620},
            "data": {
                "label": "MCP: Write Plan Artifact",
                "mcp_server_id": mcp_server_id,
                "tool_name": "write_artifact",
                "arguments_text": _json_payload(
                    {
                        "path": DEMO_ARTIFACT_PLAN,
                        "content": "{compose_plan_output}",
                        "overwrite": True,
                    }
                ),
                "on_failure": "abort",
            },
        },
        {
            "id": "write_manifest",
            "type": "agent/mcp_call",
            "position": {"x": 920, "y": 620},
            "data": {
                "label": "MCP: Write Manifest Artifact",
                "mcp_server_id": mcp_server_id,
                "tool_name": "write_artifact",
                "arguments_text": _json_payload(
                    {
                        "path": DEMO_ARTIFACT_MANIFEST,
                        "content": "{compose_manifest_output}",
                        "overwrite": True,
                    }
                ),
                "on_failure": "abort",
            },
        },
        {
            "id": "check_plan",
            "type": "agent/mcp_call",
            "position": {"x": 210, "y": 850},
            "data": {
                "label": "MCP: Verify Plan Artifact",
                "mcp_server_id": mcp_server_id,
                "tool_name": "artifact_status",
                "arguments_text": _json_payload({"path": DEMO_ARTIFACT_PLAN}),
                "on_failure": "abort",
            },
        },
        {
            "id": "preview_plan",
            "type": "agent/mcp_call",
            "position": {"x": 530, "y": 850},
            "data": {
                "label": "MCP: Preview Plan",
                "mcp_server_id": mcp_server_id,
                "tool_name": "read_artifact",
                "arguments_text": _json_payload({"path": DEMO_ARTIFACT_PLAN, "max_chars": 2200}),
                "on_failure": "abort",
            },
        },
        {
            "id": "check_manifest",
            "type": "agent/mcp_call",
            "position": {"x": 850, "y": 850},
            "data": {
                "label": "MCP: Verify Manifest Artifact",
                "mcp_server_id": mcp_server_id,
                "tool_name": "artifact_status",
                "arguments_text": _json_payload({"path": DEMO_ARTIFACT_MANIFEST}),
                "on_failure": "abort",
            },
        },
        {
            "id": "preview_manifest",
            "type": "agent/mcp_call",
            "position": {"x": 1170, "y": 850},
            "data": {
                "label": "MCP: Preview Manifest",
                "mcp_server_id": mcp_server_id,
                "tool_name": "read_artifact",
                "arguments_text": _json_payload({"path": DEMO_ARTIFACT_MANIFEST, "max_chars": 1800}),
                "on_failure": "abort",
            },
        },
        {
            "id": "final_report",
            "type": "output/report",
            "position": {"x": 620, "y": 1090},
            "data": {
                "label": "Final MCP Showcase Report",
                "template": (
                    "# MCP Workspace Forge Report\n\n"
                    "## Run Context\n"
                    "- Requested by: {requested_by}\n"
                    "- Requested at: {requested_at}\n"
                    "- TODO hotspot: {todo_flag_output}\n"
                    "- AI node status: {ai_brief_status}\n"
                    "- AI node error: {ai_brief_error}\n\n"
                    "## Workspace Snapshot\n"
                    "{scan_workspace_output}\n\n"
                    "## TODO Scan\n"
                    "{scan_todos_output}\n\n"
                    "## Generated Action Plan\n"
                    "{compose_plan_output}\n\n"
                    "## Plan Artifact Check\n"
                    "{check_plan_output}\n\n"
                    "## Manifest Artifact Check\n"
                    "{check_manifest_output}\n\n"
                    "## Plan Preview\n"
                    "{preview_plan_output}\n\n"
                    "## Manifest Preview\n"
                    "{preview_manifest_output}\n"
                ),
            },
        },
    ]


def build_showcase_edges() -> list[dict]:
    return [
        {"id": "e1", "source": "start_manual", "target": "scan_workspace", "animated": True},
        {"id": "e2", "source": "start_manual", "target": "scan_todos", "animated": True},
        {"id": "e3", "source": "scan_workspace", "target": "ai_brief", "animated": True},
        {"id": "e4", "source": "scan_todos", "target": "ai_brief", "animated": True},
        {"id": "e5", "source": "scan_workspace", "target": "compose_plan", "animated": True},
        {"id": "e6", "source": "scan_todos", "target": "compose_plan", "animated": True},
        {"id": "e7", "source": "ai_brief", "target": "compose_plan", "animated": True},
        {"id": "e8", "source": "scan_todos", "target": "todo_flag", "animated": True},
        {"id": "e9", "source": "scan_workspace", "target": "compose_manifest", "animated": True},
        {"id": "e10", "source": "scan_todos", "target": "compose_manifest", "animated": True},
        {"id": "e11", "source": "compose_plan", "target": "compose_manifest", "animated": True},
        {"id": "e12", "source": "ai_brief", "target": "compose_manifest", "animated": True},
        {"id": "e13", "source": "compose_plan", "target": "write_plan", "animated": True},
        {"id": "e14", "source": "compose_manifest", "target": "write_manifest", "animated": True},
        {"id": "e15", "source": "write_plan", "target": "check_plan", "animated": True},
        {"id": "e16", "source": "write_plan", "target": "preview_plan", "animated": True},
        {"id": "e17", "source": "write_manifest", "target": "check_manifest", "animated": True},
        {"id": "e18", "source": "write_manifest", "target": "preview_manifest", "animated": True},
        {"id": "e19", "source": "todo_flag", "target": "final_report", "animated": True},
        {"id": "e20", "source": "check_plan", "target": "final_report", "animated": True},
        {"id": "e21", "source": "preview_plan", "target": "final_report", "animated": True},
        {"id": "e22", "source": "check_manifest", "target": "final_report", "animated": True},
        {"id": "e23", "source": "preview_manifest", "target": "final_report", "animated": True},
    ]


def ensure_showcase_pipeline(user, mcp_server: MCPServerPool) -> Pipeline:
    pipeline, _ = Pipeline.objects.update_or_create(
        owner=user,
        name=DEMO_PIPELINE_NAME,
        defaults={
            "description": (
                "Large MCP-first showcase pipeline for Studio. It scans the workspace, "
                "collects TODO hotspots, builds a deterministic action plan, writes two "
                "artifacts to disk, verifies them, and compiles a final report."
            ),
            "icon": "MCP",
            "tags": ["mcp", "showcase", "local", "artifacts", "studio"],
            "nodes": build_showcase_nodes(mcp_server.id),
            "edges": build_showcase_edges(),
            "is_shared": False,
        },
    )
    pipeline.sync_triggers_from_nodes()
    return pipeline


def create_showcase_run(pipeline: Pipeline, user) -> PipelineRun:
    return PipelineRun.objects.create(
        pipeline=pipeline,
        triggered_by=user,
        status=PipelineRun.STATUS_PENDING,
        context={},
        trigger_data={"source": "manual", "showcase": "mcp"},
    )


async def execute_showcase_run(run: PipelineRun, requested_by: str) -> PipelineRun:
    executor = PipelineExecutor(run)
    return await executor.execute(
        context={
            "requested_by": requested_by,
            "requested_at": timezone.now().isoformat(),
        }
    )
