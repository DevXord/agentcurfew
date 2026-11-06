# Development changelog

A running log of what each session on agentcurfew did. Not the user-facing changelog, which starts with the first publish.

## 2026-11-06: Phase 9, release machinery without a release

- The maintainer decided that the first release is 1.0.0 with phases 7 and 8, so this phase publishes nothing and the version stays 0.0.0.
- `ci.yml`: tests on Node 22 and 24, a smoke test of the assembled package (`scripts/smoke.sh`) on Node 18, 20, 22, 24 and 26, and a self-check with `agentcurfew scan`, `verify` and `doctor` on this repository and `depcurfew doctor` (D-022). The repository now has its own `agentcurfew.lock`.
- `release.yml`: from a `v*` tag, test and pack, then, after approval of the environment `npm`, stage the tested tarball on npm with OIDC; it goes live only after `npm stage approve` with 2FA (D-023). `docs/RELEASING.md` lists the maintainer's steps; `CHANGELOG.md` starts for users.
- `action.yml` runs agentcurfew from npm for released versions and builds from source for 0.0.0 (D-024).
- `depcurfew` is excluded from the cooldown, as the maintainer decided, since all its releases were younger than 7 days; npm 11.21.1 honors the exclusion for install but not for exec.
- Action SHAs written from memory in a first draft were wrong; all pins are now read with `git ls-remote` and dated.
- First CI run (2026-11-06): all nine jobs green, including the smoke test on Node 18.20.8, 20, 22, 24 and 26; `engines` is now `>=18.20.0` (Q-004).

## 2026-11-06: Phase 6, CLI for people, SARIF and GitHub Action

- One table of commands gives the welcome screen (`acf` with no arguments), `help`, `help <command>` and `<command> --help`, the options of `parseArgs` and the suggestions for mistyped commands, options, rules and help topics (D-019). Every error has what, where and a fix.
- Colors only for labels, only on a terminal; `NO_COLOR` wins over `FORCE_COLOR`, and the label's text is always there.
- `scan --sarif`: SARIF 2.1.0 with rules, OWASP tags, `security-severity`, stable fingerprints and policy exceptions as suppressions (D-020).
- JSON Schemas of every `--json` output in `schemas/` (in the package), described in `docs/cli-json.md`.
- `action.yml`: a composite action with pinned SHAs that builds from source until the npm release, and `.github/workflows/action-test.yml`, which runs it on fixtures (D-021).
- `ajv` as a dev dependency validates SARIF against the official schema, stored with its source and checksum, and the JSON outputs against `schemas/` (D-018).
- Tests: every help example runs, 22 screen snapshots, errors in three lines, colors only on labels, SARIF valid for every rule fixture and deterministic, JSON outputs valid against their schemas. 326 tests.

## 2026-11-06: Phase 5, policy and doctor

- `agentcurfew.policy.json` with `schema.json` (D-016): settings that raise or lower rules, allowed skill sources and MCP servers, excluded paths and exceptions with a reason and an optional end date. A validator without dependencies reads the schema itself and names the path of each problem. `docs/policy.md` is generated from the schema.
- The rule `out-of-policy` (AST09): skills from sources not allowed or of unknown source, skills with executables when they are not allowed, MCP servers whose package, image or address is not allowed.
- `acf init` proposes a policy the project passes and lists what it left loose; `--print`, `--force`, never through a link.
- `acf doctor` with nine checks (D-017), each finding with an https source, `docs/doctor.md` generated from the checks. Deprecations are a new list of facts in the knowledge base.
- `scan`, `lock` and `verify` apply the policy through one `analyzeProject`; an invalid policy stops them. `scan --json` is version 3.
- This repository has its own `agentcurfew.policy.json`, which leaves out the test fixtures: `acf scan .` reports nothing and `acf doctor .` passes.
- Tests: every field of the schema accepted and refused with its path, keywords of the schema limited to what the validator implements, each setting both ways, exceptions on and after their date, exclusion in scan and lock, init on a project and its idempotence, a positive and a negative fixture for every doctor check, CLI exit codes. `npm run fuzz` validates random policies. 278 tests.

Not verified: deprecated Windsurf paths, because `docs.devin.ai` was not reachable (Q-011).

## 2026-11-06: Phase 4, lockfile and verification

- `acf lock` writes `agentcurfew.lock` (D-014): every project component with a SHA-256 checksum, MCP servers with command, arguments and addresses with secrets redacted and the package they fetch, skills with a checksum per file and their executables. Text is normalized from CRLF, keys are sorted, nothing machine-specific is written, and an unchanged project leaves the file untouched.
- `acf verify` exits with 1 on drift and says what changed: files of a skill, arguments, addresses, environment and header names, execute bits, or content. The rule `drift` reports the same in `acf scan` when a lock exists.
- `skills-lock.json`: `computedHash` is recomputed over installed skills and compared by the new rule `skills-lock-mismatch`, a warning that never fails `verify` (D-015). The algorithm was read again in `local-lock.ts` at v1.7.6, still the latest version.
- The inventory now records for each skill file whether a link was crossed, the execute bit and the raw bytes; none of it is printed. The launcher parser moved to `src/rules/launch.ts`, shared by the rule and the lock. Rules can look at the whole project (`checkProject`), with the locks in their context.
- Tests: lock twice is identical, CRLF and key order do not count, a lock written by hand matches, every kind of component drifts when edited, added or removed, secrets stay out of the lock while their change is seen, hostile and missing locks give a reason and a fix, execute bits on Windows, `skills-lock.json` against an independent implementation. `npm run fuzz` reads random locks. 209 tests.

Not verified: execute bits on Windows (only simulated); the effect of different locales on `computedHash`.

## 2026-11-06: Phase 3, rules

- First run on Linux (Node 22.23.4): `npm ci`, `npm test` (99 tests, including the link to a file outside the project that Windows skipped), `fuzz`, `typecheck`, `check:pkg` and `npx depcurfew doctor` passed with no change. The container's npm is 10.9.9, not the pinned 11.21.1, which ignores the cooldown (Q-009).
- `src/rules/`: an engine (D-013) and eleven rules: `hidden-unicode`, `unpinned-mcp-server`, `plain-http-mcp`, `secret-in-config`, `dangerous-hook-command`, `auto-run-on-open`, `permission-bypass`, `broad-shell-permission`, `remote-instructions`, `obfuscated-content`, `persistence-instruction`. Drift and out-of-policy wait for phases 4 and 5. OWASP AST01 to AST10 checked against the OWASP repository (version 1.0, 2026).
- `acf scan` runs the rules, with `--fail-on` (default `high`) and JSON schema version 2; `acf explain <rule>`; help with examples that a test runs.
- `yaml` 2.9.1 for frontmatter, with a 32 KB limit after tests on hostile input (D-012). The D-011 gaps are closed: frontmatter hooks, Gemini policies, Cursor `workspaceOpen`, local-scope servers in `~/.claude.json`. Skill files are typed and read for the rules.
- Knowledge: new fields `fromProject`, `allowAllShell`, `grantsField`, `autoStartEvents`, `otherUrls`, from sources read in this session: Claude Code docs on skills, subagents, hooks in frontmatter and permission rules; Gemini CLI's `hookRegistry.ts`, `mcp-client.ts` and shell docs; Codex's config loader; Cline's cron parser and reconciler. The Windsurf `serverUrl` field rests on a search summary of its docs, since the page could not be fetched here, and conflicts with phase 1; both fields are read.
- `docs/rules.md`, generated from the rules (`npm run docs:rules`), with what the tool does not find. A test fails when it is out of date.
- Tests: a positive and a negative fixture for every rule with hand-written expected findings, registry checks, secrets never printed, a scan under a second, hostile YAML, and the frontmatter and rules in `npm run fuzz`. 168 tests.
- Some source files, two of them from phase 2 (`parse.ts` and its test), held hidden characters written literally, such as a byte order mark in a regular expression. They are now `\u` escapes, and a test fails on any hidden character in the repository.

Not verified: the credential formats of `secret-in-config` (Q-010); the `allowAllShell` entry of Gemini CLI is inferred from two pages; Cursor's remote MCP field was not read from Cursor's site, which was not reachable. Scanning this repository reports its own fixtures under `tests/fixtures/repos`; exclusions come with the policy in phase 5.

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
