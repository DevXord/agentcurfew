# Project rules for agentcurfew

## Purpose
Local MIT CLI that inventories what steers AI coding agents (skills, MCP servers, hooks, context files, permissions), locks the inventory with checksums, enforces a policy and flags dangerous patterns. Sibling project: [depcurfew](https://github.com/DevXord/depcurfew) (protects *packages*; we protect what configures the *agent*).

## Hard rules
- The scanner NEVER runs any command, script, hook or MCP server that it finds, and NEVER uses the network. If a check would need either, it does not belong in agentcurfew.
- We do not duplicate depcurfew. Checking packages installed by the agent, release-age checks, similar-name detection and OSV data stay in depcurfew. When we need to check a package (e.g. an MCP server launched by `npx` or `uvx`), we call depcurfew's public API as an optional peer dependency instead of re-implementing its logic.
- Work only on agentcurfew here. depcurfew may be used as a model and general helpers may be copied from it, but do not change or develop that package: it has its own session.
- Runtime dependencies: only `yaml` when strictly needed for one agent format, one zero-dep TOML parser when strictly needed for Codex's config, and `depcurfew` as an optional peer. Every dependency gets a prior ask and a justification in the maintainer's decision log.
- Every fact about an agent (file paths, formats, config precedence, hook and MCP schemas, skill format) lives only in `src/knowledge/`. Each entry has a `source` (URL of official docs or source code) and a `verifiedAt` date. A test refuses an entry without a source.
- Never write a fact about an agent from memory. Verify in the current docs (WebFetch / WebSearch) and record the source. Keep conflicting sources both and mark the field as disputed.
- Every rule has an id, a level, a description, an OWASP Agentic Skills Top 10 reference, a fix hint, an entry in `docs/rules.md` and both a positive and a negative fixture.
- Input files are hostile: size and depth caps, no following symlinks out of the project, secret masking in results.
- The lockfile is deterministic: stable sorting, no timestamps in content, relative paths.
- ESM only. No top-level `await`. Code, comments, docs and CLI messages in English.
- Tests must not touch the network; fixtures live under `tests/fixtures`.
- Do not publish to npm, push commits or create accounts without an explicit OK from the maintainer.

## Commands
- `npm test` — Vitest, including rule fixtures and CLI snapshots.
- `npm run fuzz` — fuzzing of parsers (fast-check).
- `npm run check:pkg` — `tsdown` + `publint` + `@arethetypeswrong/cli`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run build` — tsdown.

## Way of working
- The development documents (the plan, the decision log, the development log, the handoff and the notes for depcurfew) are kept by the maintainer outside this public repository: nobody may see the further development of the package. Never create, commit or push them; they are listed in `.gitignore`.
- One phase of the plan per session. Start a session by reading the development documents the maintainer gives you.
- Begin in plan mode and wait for approval.
- Tests and fixtures first, implementation second.
- End of phase: a commit of code, tests and user-facing docs only; the updated development documents (log entry, decisions, open questions, plan) go to the maintainer as files, not into the repository.
