# MCP Workspace Forge

## Objective
Create a local MCP validation pack for Studio, write real workspace artifacts, and show that the MCP nodes can inspect, generate, persist, and verify outputs.

## Repository Signal
- Scanned files: 289
- TODO matches: 40
- Hotspot: yes

## Action Cards
1. Inspect the workspace snapshot and validate that the MCP server can read repository state.
2. Review TODO hotspots and decide whether they represent real technical debt or placeholders.
3. Confirm that the generated artifacts under `.tmp_mcp_demo/` contain the expected data.
4. Re-run the pipeline after edits to compare artifact hashes and file previews.

## Optional AI Brief
- Snapshot: 289 files; primary languages Python (102) and TSX (93). Top directories: ai-server-terminal-main, servers, core_ui, studio — mix of backend orchestration and frontend UI assets; important config files present (.env, .model_config.json, db.sqlite3).
- Risk hotspot: 40 TODO/FIXME/HACK matches clustered in studio/* and ai-server-terminal-main, touching pipeline orchestration (demo_mcp_server.py, mcp_showcase.py, demo_mcp_server orchestration paths) — high likelihood of latent bugs or unimplemented behavior affecting runs.
- Immediate (first 48–72h): triage TODOs to classify actionable bugs vs. placeholders, mark critical items; run full linters and unit/TS type tests; add blocking tickets for orchestration TODOs and triage owners for release gating.
- Medium-term execution: assign owners and create tracked tickets for high-impact TODOs; enforce CI gates (lint + tests) and add a pre-merge check to flag new TODO/HACK comments; add deterministic brief/regression tests around orchestration flows and demo servers.
- Blockers & mitigations: unresolved TODOs in orchestration code are the top release blocker — mitigate by locking owners, blocking releases until critical triage is complete, and prioritizing tests around deterministic pipeline behaviors and demo_mcp_server endpoints.

AI_SIGNAL: READY

## Verification Checklist
- Artifact plan file exists.
- Artifact manifest file exists.
- Preview node shows markdown and JSON content.
HOTSPOT: yes
STATUS: READY