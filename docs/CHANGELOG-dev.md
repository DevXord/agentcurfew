# Development changelog

A running log of what each session on agentcurfew did. Not the user-facing changelog, which starts with the first publish.

## 2026-11-06: Phase 2, inventory

- `src/inventory/`: `scanInventory` finds skills, MCP servers, hooks, automatic starts, context files, permissions, subagents and commands from the knowledge base alone (D-011).
- `files.ts` reads with limits on file size, depth and entries, does not follow links out of the project or the home directory, and skips anything that is not a regular file. `parse.ts` reads JSON with comments and TOML (`smol-toml`, D-010).
- `acf scan [directory] --inventory [--json] [--user]`. The home directory and machine settings are read only with `--user`.
- 17 repository fixtures in `tests/fixtures/repos`, with expected results written by hand from the knowledge base. Tests also cover links, limits, user scope, secrets staying out of the output, hidden characters in names, and that nothing is executed. `npm run fuzz` now covers the parsers.
- Knowledge types: per-file hook key, list container of `tasks.json`.

Not verified: the test for a file link that leaves the project is skipped on this Windows machine, which refuses file links without Developer Mode; directory links are tested. Everything has only run on Windows with Node 25.8.1.

## 2026-11-06: Phase 1, knowledge base

- `src/knowledge/`: one module per agent (Claude Code, Cursor, Codex CLI, Gemini CLI, Copilot in VS Code, Windsurf, Cline), plus `shared.ts` for the Agent Skills format and `skills-lock.json`. Each module was researched separately from official docs and source code, and all facts are dated 2026-11-06.
- 56 agent facts: 41 verified, 10 uncertain, 5 disputed. The open ones are listed at the top of [docs/knowledge.md](knowledge.md).
- `validate.ts` refuses a fact without an https source and a date; tests run it over every module. `render.ts` and `npm run docs:knowledge` generate `docs/knowledge.md`, and a test fails when that file is out of date.
- Types changed after the research (D-008), which fixed portable MCP files that a scanner would have missed.
- Checked by hand against primary sources after the research: the Windsurf redirect, `computedHash`, and the MCP keys of VS Code. The other facts rest on the research runs and were not re-read.

Not done: the knowledge base is not used by any command yet and is not exported from the package. Open questions for review: Q-006 (TOML parser), Q-007 (Windsurf name), Q-001 (alias).

## 2026-11-06: Phase 0, skeleton

- Moved the brief to [docs/PLAN.md](PLAN.md); added [CLAUDE.md](../CLAUDE.md) (section 7 of the plan, translated to English), [docs/decisions.md](decisions.md) and this changelog.
- `package.json`: ESM-only, binaries `agentcurfew` and `acf`, no runtime dependencies, exact dev pins (D-005).
- CLI scaffold: `src/cli.ts` (entry wrapper for closed pipes and the `NO_COLOR` warning, adapted from depcurfew), `src/cli/run.ts` (`util.parseArgs`, help, version, errors in the what/where/fix form), `src/cli/io.ts`, `src/version.ts`. Help lists the commands of the plan as planned, because none exists yet.
- Tests: `tests/cli.test.ts`, `tests/setup.test.ts` and two guards that make the network and every `child_process` API throw. `npm run fuzz` runs `tests/fuzz/cli-args.fuzz.ts` (fast-check, 2000 runs).
- Repository policy: `depcurfew.json`, plus `.npmrc` from `depcurfew apply` (D-006).
- `LICENSE`, `SECURITY.md`, `README.md`, `.gitignore`.

Not done in this phase: `src/knowledge/` is empty (phase 1). Only Node 25.8.1 was used, so the `engines` floor is unproven (Q-004).
