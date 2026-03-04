---
name: Keycloak TEST Profile
description: Environment skill for Keycloak TEST operations. Pins work to the test profile and blocks profile switching.
service: keycloak
category: Identity and Access
safety_level: high
ui_hint: Use this for TEST-only bots. The runtime pins profile=test on Keycloak MCP calls.
guardrail_summary: ["Pins profile=test on Keycloak MCP calls", "Blocks profile switching", "Keeps TEST bots out of other environments"]
recommended_tools: ["report", "ask_user", "analyze_output"]
runtime_policy: {"applicable_tool_patterns":["^keycloak_"],"blocked_tool_patterns":["^keycloak_use_profile$"],"pinned_arguments":{"profile":"test"},"auto_inject_pinned_arguments":true}
tags: [keycloak, iam, test, environment]
---
# Keycloak TEST Profile

Use this skill when the agent is allowed to work only in the Keycloak TEST environment.

## Environment contract

- Fixed profile: `test`
- Do not switch to any other profile.
- If `keycloak_current_environment` does not confirm `test`, stop immediately and ask the user.

## Execution rules

1. Your first Keycloak step must confirm the active environment.
2. Every mutating Keycloak MCP call must explicitly pass `profile="test"` when supported by the tool.
3. If the user request mentions `prod`, `production`, or another environment, do not continue without user confirmation.
4. All verification steps must also use the `test` profile.

## Approval guidance

- TEST is safer than PROD, but you must still avoid guessing.
- If the request is incomplete, stop and ask the user instead of inventing defaults.

## Final report

Include a line that clearly states:

`Environment used: TEST (profile=test)`
