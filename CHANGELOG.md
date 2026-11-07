# Changelog

All notable changes to agentcurfew are written here for its users. The development log is [docs/CHANGELOG-dev.md](docs/CHANGELOG-dev.md).

## Unreleased

The first release will be 1.0.0. Nothing has been published yet; the notes below are a draft for it.

### 1.0.0 (draft)

The first release. agentcurfew inventories, locks and checks the files that steer AI coding agents (Claude Code, Cursor, Codex CLI, Gemini CLI, Copilot in VS Code, Windsurf and Cline) without running any of them and without using the network.

- `scan`: lists skills, MCP servers, hooks, automatic tasks, context files, permissions, subagents and commands from a sourced knowledge base, and checks them against 15 rules, each with an OWASP Agentic Skills Top 10 reference, a fix and an example. Text, JSON (with published schemas) and SARIF 2.1.0 output; `--fail-on`; a file that could not be read fails the scan; `--user` for the home directory and machine settings.
- `lock` and `verify`: `agentcurfew.lock` holds a checksum of every component, with MCP servers' commands and addresses (secrets redacted); `verify` fails when anything was added, removed or changed. Skills are also compared with `skills-lock.json`.
- `init` and `agentcurfew.policy.json`: allowed skill sources and MCP servers, pinned versions, plain HTTP, network in hooks, auto-run on open, hidden Unicode, excluded paths, and exceptions with a reason and an end date. A JSON schema for editors.
- `doctor`: 12 checks for configuration that agents ignore or that does not work, each naming its source.
- `mcp`: a read-only MCP server (2026-07-28 and 2025-11-25) with `scan_project`, `check_skill`, `check_mcp_config` and `explain_rule`.
- `hook` and `init --hook`: a Claude Code `PreToolUse` hook that asks before writes to the files that steer agents and denies dangerous ones, and checks `npx skills add` and `claude mcp add` against the policy.
- depcurfew as an optional peer (`>=1.5.2 <2`): the rule `mcp-package` checks the packages that MCP servers start, offline; `doctor` checks depcurfew's hook.
- A GitHub Action (`scan`, `verify` or `doctor`, with SARIF upload).
- Hostile input: size, depth and total-read limits, links not followed out of the project, secrets masked in every output and redacted in the lock, and patterns that read padded text in linear time.
- Node.js 18.20 or later; one runtime dependency each for YAML and TOML.
