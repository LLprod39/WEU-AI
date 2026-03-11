---
name: test
description: testse
safety_level: standard
guardrail_summary: ["etst"]
tags: ["test"]
---
# test

Use this skill for work done through MCP tools against the target service.

## When to use

- The user asks for operational work that touches the target service.
- The request is free-form, ambiguous, or safety-sensitive.
- The environment, tenant, realm, project, or profile must be resolved before mutation.

## Mandatory workflow

1. Start with environment and permission discovery using the correct read-only MCP tools.
2. Normalize the user request into a short structured plan before making changes.
3. Resolve exact targets with read-only discovery tools before any mutation.
4. Execute only the minimum required mutations.
5. Run read-only verification after every mutation and compare the final state with the request.
6. Stop and ask the user whenever discovery is incomplete or the target is ambiguous.

## Hard rules

- Always prefer exact identifiers over fuzzy matching.
- Never mutate if discovery data is incomplete.
- Never switch context mid-run unless the user explicitly asks and confirms it.
- Always pass required environment arguments explicitly when the MCP tool supports them.
- If this skill defines runtime policy, treat it as mandatory and assume those guardrails are enforced by the platform.
- If this skill works with service-specific MCP tools, use the original tool names in the policy, for example `service_current_environment`.

## Reporting

- State which environment, tenant, realm, profile, or project was used.
- State which entities were discovered before mutation.
- State which mutations were applied and which were skipped.
- State which verification calls were used.
- State any ambiguity, blockers, or follow-up required.
