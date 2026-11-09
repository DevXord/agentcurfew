# Changelog

All notable changes to agentcurfew are written here for its users.

## Unreleased

Nothing yet.

## 1.1.0

- Settings that run a command are read: Claude Code `statusLine`, `subagentStatusLine`, `fileSuggestion`, `apiKeyHelper`, `otelHeadersHelper`, `awsAuthRefresh`, `awsCredentialExport` and `gcpAuthRefresh`, as components of the new kind `command-setting`; `statusLine` and `otelHeadersHelper`, which run when a session starts, are also `auto-run`. Codex `notify` is read from the user's config only, since Codex ignores it in a project. `dangerous-hook-command`, `secret-in-config` and `hidden-unicode` check them.
- The scripts of the project that hooks, editor tasks and these settings run (`./scripts/x.sh`, `python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/x.py`) are read with the same limits as other files, checked by the same rules, and locked with their own checksums, so `verify` reports `script changed`. Installed packages (`node_modules`) and files the root `.gitignore` ignores are left out.
- Every component has a stable `id`. A hook's is its event, its matcher and a hash of its handler (with secrets redacted), so it no longer shifts when a hook is added before it: `verify` then reports one added hook instead of changes to every later one, and the hook check does not take a moved finding for a new one. Locks of 1.0 without ids still work, compared by name, with a note.
- The JSON output names its `producer` (version and the date of the knowledge base), gives each component its `id` and lock checksum `hash`, and ties findings to components with `componentId`; `verify --json` adds `lockDigest`. SARIF adds the fingerprint `agentcurfew/v2` by id and keeps `agentcurfew/v1`. No `schemaVersion` changed.
- After upgrading, run `agentcurfew lock` once: the lock gains the new components and the scripts' checksums, and the hashes of existing entries do not change.
- Node.js 20 or later (`engines` `>=20.0.0`), instead of 22.23: nothing in agentcurfew needs a newer Node, and CI runs the packed CLI on Node 20.0.0, 20, 22, 24 and 26.

## 1.0.0

The first release. agentcurfew inventories, locks and checks the files that steer AI coding agents (Claude Code, Cursor, Codex CLI, Gemini CLI, Copilot in VS Code, Windsurf and Cline) without running any of them and without using the network.

- `scan`: lists skills, MCP servers, hooks, automatic tasks, context files, permissions, subagents and commands from a sourced knowledge base, and checks them against 15 rules, each with an OWASP Agentic Skills Top 10 reference, a fix and an example. Text, JSON (with published schemas) and SARIF 2.1.0 output; `--fail-on`; a file that could not be read fails the scan; `--user` for the home directory and machine settings.
- `lock` and `verify`: `agentcurfew.lock` holds a checksum of every component, with MCP servers' commands and addresses; secrets are redacted, also from the hashes, so a committed lock reveals none; `verify` fails when anything was added, removed or changed. Skills are also compared with `skills-lock.json`.
- `init` and `agentcurfew.policy.json`: allowed skill sources and MCP servers, pinned versions, plain HTTP, network in hooks, auto-run on open, hidden Unicode, excluded paths, and exceptions with a reason and an end date. A JSON schema for editors.
- `doctor`: 13 checks for configuration that agents ignore or that does not work, each naming its source.
- `mcp`: a read-only MCP server (2026-07-28 and 2025-11-25) with `scan_project`, `check_skill`, `check_mcp_config` and `explain_rule`.
- `hook` and `init --hook`: a Claude Code `PreToolUse` hook that asks before writes to the files that steer agents and denies dangerous ones, and checks `npx skills add` and `claude mcp add` against the policy.
- depcurfew as an optional peer (`>=1.5.2 <2`): the rule `mcp-package` checks the packages that MCP servers start, offline; `doctor` checks depcurfew's hook.
- A GitHub Action (`scan`, `verify` or `doctor`, with SARIF upload).
- Hostile input: size, depth and total-read limits, links not followed out of the project, secrets masked in every output and redacted in the lock, and patterns that read padded text in linear time.
- Node.js 22.23 or later; one runtime dependency each for YAML and TOML.
