from __future__ import annotations

import json
import os

from django.conf import settings

from .models import MCPServerPool, Pipeline

KEYCLOAK_MCP_NAME = "Keycloak Admin"
KEYCLOAK_MCP_URL = os.getenv("STUDIO_KEYCLOAK_MCP_URL", "http://127.0.0.1:8766/mcp")
KEYCLOAK_PIPELINE_NAME = "Keycloak Provisioning with Approval"
KEYCLOAK_PIPELINE_DESCRIPTION = (
    "Human-approved Keycloak provisioning flow for Studio. It accepts manual or webhook context, "
    "runs a read-only preflight against Keycloak, asks for approval, then lets an MCP-enabled agent "
    "create the user, assign realm roles, assign client roles, add groups, and verify the final state."
)
KEYCLOAK_OPS_PIPELINE_SPECS = {
    "test": {
        "name": "Keycloak Ops TEST",
        "description": (
            "Direct Keycloak operator pipeline for the TEST environment. "
            "Accepts free-form user requests, uses the fixed 'test' MCP profile, and sends no email or Telegram messages."
        ),
        "label": "TEST",
    },
    "prod": {
        "name": "Keycloak Ops PROD",
        "description": (
            "Direct Keycloak operator pipeline for the PROD environment. "
            "Accepts free-form user requests, uses the fixed 'prod' MCP profile, and sends no email or Telegram messages."
        ),
        "label": "PROD",
    },
}

SAMPLE_MANUAL_CONTEXT = {
    "profile": "prod",
    "username": "ivan.petrov",
    "email": "ivan.petrov@example.com",
    "first_name": "Ivan",
    "last_name": "Petrov",
    "temporary_password": "Temp12345!",
    "realm_roles": ["offline_access"],
    "client_roles": {"crm-app": ["read", "write"]},
    "groups": ["/sales", "/crm-users"],
    "attributes": {"department": ["sales"]},
    "required_actions": ["UPDATE_PASSWORD"],
    "allow_existing_user": False,
}
SAMPLE_TASK_CONTEXT = {
    "task": "Создай пользователя ivan.petrov, выдай роли crm-app: read, write и добавь в группы /sales и /crm-users",
    "requester": "Service Desk",
    "ticket_id": "IAM-1001",
    "username": "ivan.petrov",
    "email": "ivan.petrov@example.com",
    "first_name": "Ivan",
    "last_name": "Petrov",
    "temporary_password": "Temp12345!",
    "realm_roles": ["offline_access"],
    "client_roles": {"crm-app": ["read", "write"]},
    "groups": ["/sales", "/crm-users"],
    "attributes": {"department": ["sales"]},
    "required_actions": ["UPDATE_PASSWORD"],
    "allow_existing_user": False,
}

WEBHOOK_CONTEXT_MAP = {
    "profile": "profile",
    "base_url": "base_url",
    "realm": "realm",
    "token_realm": "token_realm",
    "client_id": "client_id",
    "admin_user": "admin_user",
    "admin_password_env": "admin_password_env",
    "client_secret_env": "client_secret_env",
    "username": "username",
    "email": "email",
    "first_name": "first_name",
    "last_name": "last_name",
    "temporary_password": "temporary_password",
    "realm_roles": "realm_roles",
    "client_roles": "client_roles",
    "groups": "groups",
    "attributes": "attributes",
    "required_actions": "required_actions",
    "allow_existing_user": "allow_existing_user",
}
TASK_WEBHOOK_CONTEXT_MAP = {
    "task": "task",
    "requester": "requester",
    "ticket_id": "ticket_id",
    "username": "username",
    "email": "email",
    "first_name": "first_name",
    "last_name": "last_name",
    "temporary_password": "temporary_password",
    "realm_roles": "realm_roles",
    "client_roles": "client_roles",
    "groups": "groups",
    "attributes": "attributes",
    "required_actions": "required_actions",
    "allow_existing_user": "allow_existing_user",
}


def _json_payload(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def ensure_keycloak_mcp_server(user) -> MCPServerPool:
    server, _ = MCPServerPool.objects.update_or_create(
        owner=user,
        name=KEYCLOAK_MCP_NAME,
        defaults={
            "description": (
                "URL-based Keycloak admin MCP for user, role, client, and group provisioning. "
                "Recommended to run as docker-compose service mcp-keycloak."
            ),
            "transport": MCPServerPool.TRANSPORT_SSE,
            "command": "",
            "args": [],
            "env": {},
            "url": KEYCLOAK_MCP_URL,
            "is_shared": False,
        },
    )
    return server


def build_keycloak_nodes(mcp_server_id: int) -> list[dict]:
    return [
        {
            "id": "start_manual",
            "type": "trigger/manual",
            "position": {"x": 340, "y": 40},
            "data": {
                "label": "Run Provisioning",
                "is_active": True,
                "description": "Manual run expects JSON context via the pipeline run API.",
            },
        },
        {
            "id": "start_webhook",
            "type": "trigger/webhook",
            "position": {"x": 820, "y": 40},
            "data": {
                "label": "Webhook Provisioning",
                "is_active": True,
                "webhook_payload_map": WEBHOOK_CONTEXT_MAP,
            },
        },
        {
            "id": "environment_preflight",
            "type": "agent/mcp_call",
            "position": {"x": 190, "y": 210},
            "data": {
                "label": "MCP: Environment Preflight",
                "mcp_server_id": mcp_server_id,
                "tool_name": "keycloak_current_environment",
                "arguments_text": _json_payload({"profile": "{profile}"}),
                "on_failure": "continue",
            },
        },
        {
            "id": "existing_user_lookup",
            "type": "agent/mcp_call",
            "position": {"x": 640, "y": 210},
            "data": {
                "label": "MCP: Existing User Lookup",
                "mcp_server_id": mcp_server_id,
                "tool_name": "keycloak_find_user",
                "arguments_text": _json_payload({"login": "{username}", "profile": "{profile}"}),
                "on_failure": "continue",
            },
        },
        {
            "id": "normalize_request",
            "type": "agent/llm_query",
            "position": {"x": 430, "y": 430},
            "data": {
                "label": "Model: Build Provisioning Plan",
                "provider": "openai",
                "model": "gpt-5-mini",
                "system_prompt": (
                    "You are a careful IAM provisioning planner for Keycloak. "
                    "Normalize the request, surface risks, and produce strict machine-readable JSON."
                ),
                "prompt": (
                    "You are preparing a provisioning plan for a Keycloak MCP pipeline.\n\n"
                    "## Incoming request context\n"
                    "- profile: {profile}\n"
                    "- base_url: {base_url}\n"
                    "- realm: {realm}\n"
                    "- token_realm: {token_realm}\n"
                    "- client_id: {client_id}\n"
                    "- username: {username}\n"
                    "- email: {email}\n"
                    "- first_name: {first_name}\n"
                    "- last_name: {last_name}\n"
                    "- temporary_password: {temporary_password}\n"
                    "- realm_roles: {realm_roles}\n"
                    "- client_roles: {client_roles}\n"
                    "- groups: {groups}\n"
                    "- attributes: {attributes}\n"
                    "- required_actions: {required_actions}\n"
                    "- allow_existing_user: {allow_existing_user}\n\n"
                    "## Read-only preflight\n"
                    "Current environment:\n{environment_preflight_output}\n\n"
                    "Existing user lookup:\n{existing_user_lookup_output}\n\n"
                    "## Task\n"
                    "Return STRICT JSON only. No markdown fences.\n"
                    "Schema:\n"
                    "{\n"
                    '  "request_valid": true,\n'
                    '  "missing_fields": [],\n'
                    '  "profile": "prod",\n'
                    '  "auth": {"base_url": "", "realm": "", "token_realm": "", "client_id": ""},\n'
                    '  "user": {\n'
                    '    "username": "", "email": "", "first_name": "", "last_name": "",\n'
                    '    "temporary_password": "", "attributes": {}, "required_actions": []\n'
                    "  },\n"
                    '  "allow_existing_user": false,\n'
                    '  "realm_roles": [],\n'
                    '  "client_roles": {},\n'
                    '  "groups": [],\n'
                    '  "risk_summary": [],\n'
                    '  "approval_summary": "short human summary",\n'
                    '  "existing_user_found": false\n'
                    "}\n\n"
                    "Rules:\n"
                    "- Keep arrays/objects valid JSON.\n"
                    "- If something required is missing, set request_valid=false and list missing_fields.\n"
                    "- If existing_user_lookup found a user, set existing_user_found=true.\n"
                    "- Do not invent roles, groups, or clients that were not provided."
                ),
                "include_all_outputs": False,
                "on_failure": "abort",
            },
        },
        {
            "id": "await_approval",
            "type": "logic/human_approval",
            "position": {"x": 430, "y": 650},
            "data": {
                "label": "Await Approval",
                "to_email": "",
                "email_subject": "Keycloak provisioning approval required (run #{run_id})",
                "email_body": (
                    "A Keycloak provisioning request is waiting for your decision.\n\n"
                    "## Planned request\n"
                    "{normalize_request_output}\n\n"
                    "## Existing user lookup\n"
                    "{existing_user_lookup_output}\n\n"
                    "## Environment\n"
                    "{environment_preflight_output}\n\n"
                    "APPROVE:\n{approve_url}\n\n"
                    "REJECT:\n{reject_url}\n\n"
                    "Link lifetime: {timeout_minutes} minutes."
                ),
                "tg_bot_token": "",
                "tg_chat_id": "",
                "base_url": getattr(settings, "SITE_URL", "http://localhost:8000") or "http://localhost:8000",
                "timeout_minutes": 240,
                "message": (
                    "Keycloak provisioning approval required.\n\n"
                    "{normalize_request_output}\n\n"
                    "APPROVE: {approve_url}\n\n"
                    "REJECT: {reject_url}"
                ),
                "smtp_host": "",
                "smtp_user": "",
                "smtp_password": "",
                "from_email": "",
            },
        },
        {
            "id": "execute_keycloak_plan",
            "type": "agent/react",
            "position": {"x": 430, "y": 900},
            "data": {
                "label": "Agent: Execute Keycloak Provisioning",
                "provider": "openai",
                "model": "gpt-5-mini",
                "mcp_server_ids": [mcp_server_id],
                "max_iterations": 18,
                "system_prompt": (
                    "You are a Keycloak IAM operator. Execute only via attached MCP tools. "
                    "Be deterministic, do not guess missing values, and prefer exact identifiers over fuzzy matches."
                ),
                "goal": (
                    "You are executing a Keycloak provisioning request.\n\n"
                    "Approval result:\n{await_approval_output}\n\n"
                    "Normalized request JSON:\n{normalize_request_output}\n\n"
                    "Existing user lookup:\n{existing_user_lookup_output}\n\n"
                    "Current environment:\n{environment_preflight_output}\n\n"
                    "Rules:\n"
                    "1. If approval does not clearly contain APPROVED, do not perform mutations. Return a short report saying no changes were made.\n"
                    "2. Parse the normalized JSON request. If request_valid is false or missing_fields is non-empty, stop and report the validation failure.\n"
                    "3. Use the attached Keycloak MCP tools only.\n"
                    "4. First determine whether the target user already exists. Reuse exact user_id when possible.\n"
                    "5. If the user exists and allow_existing_user is false, stop and report without changing anything.\n"
                    "6. If the user does not exist, create the user with the provided profile/auth settings and temporary password if present.\n"
                    "7. Assign realm roles, then client roles, then groups. Only apply items explicitly listed in the normalized request.\n"
                    "8. After mutations, verify the final state using read tools for realm roles, client roles, and groups.\n"
                    "9. Never use allow_fuzzy_user_match unless you first verified the exact target from read-only lookup output.\n"
                    "10. Return a final Markdown report with sections: Summary, Actions Performed, Skipped, Verification, Errors."
                ),
                "on_failure": "abort",
            },
        },
        {
            "id": "final_report",
            "type": "output/report",
            "position": {"x": 430, "y": 1150},
            "data": {
                "label": "Provisioning Report",
                "template": (
                    "# Keycloak Provisioning Report\n\n"
                    "## Input\n"
                    "- profile: {profile}\n"
                    "- username: {username}\n"
                    "- email: {email}\n"
                    "- realm_roles: {realm_roles}\n"
                    "- client_roles: {client_roles}\n"
                    "- groups: {groups}\n"
                    "- allow_existing_user: {allow_existing_user}\n\n"
                    "## Environment Preflight\n"
                    "{environment_preflight_output}\n\n"
                    "## Existing User Lookup\n"
                    "{existing_user_lookup_output}\n\n"
                    "## Normalized Plan\n"
                    "{normalize_request_output}\n\n"
                    "## Approval\n"
                    "- status: {await_approval_status}\n"
                    "- output: {await_approval_output}\n"
                    "- error: {await_approval_error}\n\n"
                    "## Execution Agent\n"
                    "- status: {execute_keycloak_plan_status}\n"
                    "- error: {execute_keycloak_plan_error}\n\n"
                    "{execute_keycloak_plan_output}\n"
                ),
            },
        },
    ]


def build_keycloak_edges() -> list[dict]:
    return [
        {"id": "e1", "source": "start_manual", "target": "environment_preflight", "animated": True},
        {"id": "e2", "source": "start_manual", "target": "existing_user_lookup", "animated": True},
        {"id": "e3", "source": "start_webhook", "target": "environment_preflight", "animated": True},
        {"id": "e4", "source": "start_webhook", "target": "existing_user_lookup", "animated": True},
        {"id": "e5", "source": "environment_preflight", "target": "normalize_request", "animated": True},
        {"id": "e6", "source": "existing_user_lookup", "target": "normalize_request", "animated": True},
        {"id": "e7", "source": "normalize_request", "target": "await_approval", "animated": True},
        {"id": "e8", "source": "normalize_request", "target": "execute_keycloak_plan", "animated": True},
        {"id": "e9", "source": "await_approval", "target": "execute_keycloak_plan", "animated": True},
        {"id": "e10", "source": "existing_user_lookup", "target": "execute_keycloak_plan", "animated": True},
        {"id": "e11", "source": "environment_preflight", "target": "execute_keycloak_plan", "animated": True},
        {"id": "e12", "source": "environment_preflight", "target": "final_report", "animated": True},
        {"id": "e13", "source": "existing_user_lookup", "target": "final_report", "animated": True},
        {"id": "e14", "source": "normalize_request", "target": "final_report", "animated": True},
        {"id": "e15", "source": "await_approval", "target": "final_report", "animated": True},
        {"id": "e16", "source": "execute_keycloak_plan", "target": "final_report", "animated": True},
    ]


def ensure_keycloak_pipeline(user, mcp_server: MCPServerPool) -> Pipeline:
    pipeline, _ = Pipeline.objects.update_or_create(
        owner=user,
        name=KEYCLOAK_PIPELINE_NAME,
        defaults={
            "description": KEYCLOAK_PIPELINE_DESCRIPTION,
            "icon": "KEY",
            "tags": ["mcp", "keycloak", "iam", "approval", "provisioning", "studio"],
            "nodes": build_keycloak_nodes(mcp_server.id),
            "edges": build_keycloak_edges(),
            "is_shared": False,
        },
    )
    pipeline.sync_triggers_from_nodes()
    return pipeline


def build_keycloak_ops_nodes(mcp_server_id: int, *, fixed_profile: str, environment_label: str) -> list[dict]:
    return [
        {
            "id": "start_manual",
            "type": "trigger/manual",
            "position": {"x": 340, "y": 40},
            "data": {
                "label": f"Run {environment_label} Keycloak Task",
                "is_active": True,
                "description": "Manual run expects JSON context with a free-form task and optional user hints.",
            },
        },
        {
            "id": "start_webhook",
            "type": "trigger/webhook",
            "position": {"x": 820, "y": 40},
            "data": {
                "label": f"{environment_label} Keycloak Webhook",
                "is_active": True,
                "webhook_payload_map": TASK_WEBHOOK_CONTEXT_MAP,
            },
        },
        {
            "id": "environment_preflight",
            "type": "agent/mcp_call",
            "position": {"x": 430, "y": 220},
            "data": {
                "label": f"MCP: {environment_label} Environment Preflight",
                "mcp_server_id": mcp_server_id,
                "tool_name": "keycloak_current_environment",
                "arguments_text": _json_payload({"profile": fixed_profile}),
                "on_failure": "abort",
            },
        },
        {
            "id": "normalize_request",
            "type": "agent/llm_query",
            "position": {"x": 430, "y": 450},
            "data": {
                "label": f"Model: Normalize {environment_label} Request",
                "provider": "openai",
                "model": "gpt-5-mini",
                "system_prompt": (
                    "You are a careful Keycloak operations planner. "
                    "Turn free-form IAM requests into strict JSON execution briefs without inventing missing values."
                ),
                "prompt": (
                    f"You are preparing an execution brief for the {environment_label} Keycloak operator pipeline.\n"
                    f"The MCP profile is FIXED to '{fixed_profile}'. Never change it.\n\n"
                    "## Incoming request\n"
                    "- task: {task}\n"
                    "- requester: {requester}\n"
                    "- ticket_id: {ticket_id}\n"
                    "- username: {username}\n"
                    "- email: {email}\n"
                    "- first_name: {first_name}\n"
                    "- last_name: {last_name}\n"
                    "- temporary_password: {temporary_password}\n"
                    "- realm_roles: {realm_roles}\n"
                    "- client_roles: {client_roles}\n"
                    "- groups: {groups}\n"
                    "- attributes: {attributes}\n"
                    "- required_actions: {required_actions}\n"
                    "- allow_existing_user: {allow_existing_user}\n\n"
                    "## Environment preflight\n"
                    "{environment_preflight_output}\n\n"
                    "## Task\n"
                    "Return STRICT JSON only. No markdown fences.\n"
                    "Schema:\n"
                    "{\n"
                    f'  "profile": "{fixed_profile}",\n'
                    '  "request_valid": true,\n'
                    '  "requested_mode": "read_only|mutating",\n'
                    '  "intent": "user_access|user_creation|group_update|role_update|user_audit|client_admin|mixed|unsupported",\n'
                    '  "task_summary": "",\n'
                    '  "target_user": {\n'
                    '    "username": "", "email": "", "first_name": "", "last_name": "",\n'
                    '    "temporary_password": "", "attributes": {}, "required_actions": []\n'
                    "  },\n"
                    '  "allow_existing_user": false,\n'
                    '  "realm_roles": [],\n'
                    '  "client_roles": {},\n'
                    '  "groups": [],\n'
                    '  "missing_fields": [],\n'
                    '  "warnings": [],\n'
                    '  "raw_task": ""\n'
                    "}\n\n"
                    "Rules:\n"
                    f"- profile must always stay '{fixed_profile}'.\n"
                    "- request_valid=false if the task is ambiguous, unsupported, or missing critical fields.\n"
                    "- requested_mode must be read_only for audit/search/list requests.\n"
                    "- Do not invent users, roles, clients, groups, passwords, or attributes.\n"
                    "- Keep arrays and objects valid JSON."
                ),
                "include_all_outputs": False,
                "on_failure": "abort",
            },
        },
        {
            "id": "execute_keycloak_task",
            "type": "agent/react",
            "position": {"x": 430, "y": 720},
            "data": {
                "label": f"Agent: Execute {environment_label} Keycloak Task",
                "provider": "openai",
                "model": "gpt-5-mini",
                "mcp_server_ids": [mcp_server_id],
                "max_iterations": 20,
                "system_prompt": (
                    "You are a Keycloak operator. Work only through attached MCP tools. "
                    "Be strict, deterministic, and stop instead of guessing."
                ),
                "goal": (
                    f"You are executing a Keycloak task against the fixed '{fixed_profile}' profile ({environment_label}).\n\n"
                    "Environment preflight:\n{environment_preflight_output}\n\n"
                    "Normalized execution brief JSON:\n{normalize_request_output}\n\n"
                    "Original requester task:\n{task}\n\n"
                    "Rules:\n"
                    f"1. Use ONLY the attached Keycloak MCP tools and ALWAYS pass profile='{fixed_profile}' in MCP calls.\n"
                    "2. Parse the normalized JSON brief first. If request_valid is false or missing_fields is non-empty, stop and make no changes.\n"
                    "3. If requested_mode is read_only, perform only search/list/read verification calls and never mutate Keycloak.\n"
                    "4. For mutating tasks, require a clearly identified target. If the user, client, role, or group is ambiguous, stop and make no changes.\n"
                    "5. Search/read first, then mutate, then verify final state with read tools.\n"
                    "6. Never use allow_fuzzy_user_match unless an exact target was already verified from read-only results.\n"
                    "7. Do not change auth connection settings, do not switch profile, and do not send email, Telegram, or external notifications.\n"
                    "8. Support the available MCP capabilities: inspect/search users, create users, assign realm roles, assign client roles, manage groups, create clients and roles when the task is explicit.\n"
                    "9. Return a final Markdown report with sections: Summary, Actions Performed, Verification, Skipped, Errors."
                ),
                "on_failure": "abort",
            },
        },
        {
            "id": "final_report",
            "type": "output/report",
            "position": {"x": 430, "y": 970},
            "data": {
                "label": f"{environment_label} Keycloak Report",
                "template": (
                    f"# Keycloak {environment_label} Execution Report\n\n"
                    f"- fixed_profile: {fixed_profile}\n"
                    "- requester: {requester}\n"
                    "- ticket_id: {ticket_id}\n"
                    "- task: {task}\n"
                    "- username: {username}\n"
                    "- email: {email}\n\n"
                    "## Environment Preflight\n"
                    "{environment_preflight_output}\n\n"
                    "## Normalized Brief\n"
                    "{normalize_request_output}\n\n"
                    "## Execution Agent\n"
                    "- status: {execute_keycloak_task_status}\n"
                    "- error: {execute_keycloak_task_error}\n\n"
                    "{execute_keycloak_task_output}\n"
                ),
            },
        },
    ]


def build_keycloak_ops_edges() -> list[dict]:
    return [
        {"id": "e1", "source": "start_manual", "target": "environment_preflight", "animated": True},
        {"id": "e2", "source": "start_webhook", "target": "environment_preflight", "animated": True},
        {"id": "e3", "source": "environment_preflight", "target": "normalize_request", "animated": True},
        {"id": "e4", "source": "normalize_request", "target": "execute_keycloak_task", "animated": True},
        {"id": "e5", "source": "environment_preflight", "target": "execute_keycloak_task", "animated": True},
        {"id": "e6", "source": "environment_preflight", "target": "final_report", "animated": True},
        {"id": "e7", "source": "normalize_request", "target": "final_report", "animated": True},
        {"id": "e8", "source": "execute_keycloak_task", "target": "final_report", "animated": True},
    ]


def ensure_keycloak_ops_pipeline(user, mcp_server: MCPServerPool, *, profile_name: str) -> Pipeline:
    spec = KEYCLOAK_OPS_PIPELINE_SPECS[profile_name]
    pipeline, _ = Pipeline.objects.update_or_create(
        owner=user,
        name=spec["name"],
        defaults={
            "description": spec["description"],
            "icon": "KEY",
            "tags": ["mcp", "keycloak", "iam", "direct", "studio", profile_name],
            "nodes": build_keycloak_ops_nodes(
                mcp_server.id,
                fixed_profile=profile_name,
                environment_label=spec["label"],
            ),
            "edges": build_keycloak_ops_edges(),
            "is_shared": False,
        },
    )
    pipeline.sync_triggers_from_nodes()
    return pipeline


def ensure_keycloak_ops_pipelines(user, mcp_server: MCPServerPool) -> dict[str, Pipeline]:
    return {
        profile_name: ensure_keycloak_ops_pipeline(user, mcp_server, profile_name=profile_name)
        for profile_name in KEYCLOAK_OPS_PIPELINE_SPECS
    }
