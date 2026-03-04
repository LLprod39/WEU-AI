---
name: Keycloak Safety Workflow
description: Safe operating workflow for Keycloak MCP tasks: preflight, exact target resolution, explicit profile usage, and verification after every mutation.
service: keycloak
category: Identity and Access
safety_level: high
ui_hint: Attach this to every Keycloak bot so the runtime enforces preflight before mutating calls and blocks profile switching.
guardrail_summary: ["Requires keycloak_current_environment before mutating calls", "Blocks keycloak_use_profile during runs", "Encourages explicit profile usage"]
recommended_tools: ["report", "ask_user", "analyze_output"]
runtime_policy: {"applicable_tool_patterns":["^keycloak_"],"blocked_tool_patterns":["^keycloak_use_profile$"],"mutating_tool_patterns":["^keycloak_create_","^keycloak_assign_","^keycloak_add_","^keycloak_delete_","^keycloak_update_"],"required_preflight_tools":["keycloak_current_environment"],"auto_inject_pinned_arguments":true}
tags: [keycloak, iam, mcp, safety]
---
# Keycloak Safety Workflow

Use this skill for any Keycloak work done through MCP tools.

## When to use

- The user asks to create, modify, or audit Keycloak users, groups, client roles, realm roles, or protocol mappers.
- The request is free-form or ambiguous.
- The environment matters and a wrong profile or realm would be dangerous.

## Mandatory workflow

1. Start with the MCP action whose original tool is `keycloak_current_environment`.
2. Read the returned environment summary and confirm the active profile, realm, token realm, and client context.
3. If the environment is missing, ambiguous, or does not match the request, stop and ask the user.
4. Resolve existing objects before mutating:
   - users via read-only lookup tools first
   - clients and roles via list/read tools first
   - groups via list/read tools first
5. Prefer exact identifiers over fuzzy matching.
6. After every mutation, run read-only verification tools and compare the final state with the request.

## Hard rules

- Always pass `profile` explicitly in Keycloak MCP calls when the tool supports it.
- Never switch profiles mid-run unless the user explicitly asks and confirms it.
- Never guess the target realm, client, group, or role.
- Never mutate if discovery data is incomplete.
- Never use fuzzy user matching for mutations unless the exact target was already proven by a prior read-only step.
- If two attached skills conflict, stop and ask the user before mutating anything.

## Recommended execution shape

1. Preflight environment.
2. Normalize the request into a short structured plan.
3. Discover existing users, groups, roles, and clients.
4. Execute only the necessary mutations.
5. Verify the final state.
6. Report actions performed, skipped actions, and any remaining uncertainty.

## Reporting

The final report should always state:

- which profile and realm were used
- which entities were discovered before mutation
- which mutations were actually applied
- which verification calls were used
- any ambiguity or skipped action
