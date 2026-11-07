# Development changelog

A running log of what each session on agentcurfew did. Not the user-facing changelog, which starts with the first publish.

## 2026-11-07: Logo and documentation site

- Logo (`site/favicon.svg`), chosen by the maintainer from three rounds of drafts: depcurfew's cube turned into a speech bubble with an agent's eyes and an AI sparkle, in violet, with depcurfew's amber clock. AI agents are shown today as a bot or a friendly character, with the sparkle as the general AI mark.
- `npm run site` builds the documentation site into `dist-site/` from README.md, the user-facing pages of docs/ and CHANGELOG.md (`scripts/site.ts`, its own Markdown subset, no new dependency). The layout and stylesheet follow depcurfew's site (https://depcurfew.github.io/) in violet: no JavaScript, nothing loaded from other hosts, light and dark schemes, level pills in tables. `tests/site/site.test.ts` checks every relative link and anchor, escaping and that nothing is loaded from elsewhere.
- Not done, for the maintainer: where the site is hosted (no `homepage`, canonical address or sitemap yet) and a workflow that publishes it.

## 2026-11-07: Secrets out of the lock's hashes

- The maintainer chose Q-015 option (b), recorded as D-035: each component's hash covers its entry with secrets redacted, so a committed lock confirms no guessed secret; a change of a secret's value alone is no longer drift. The lock test now checks both sides.
- Q-016 (configuration not read yet: statusLine, apiKeyHelper, hook scripts, plugins, Codex notify) is planned for after 1.0.0.

## 2026-11-07: A full review before 1.0.0

The maintainer asked for the whole package to be checked. Five read-only reviews ran: a functional review of the packed tarball, a penetration test of the scanner, one of the MCP server and the hook (stopped early, then done in this session), a field test on 24 public repositories, and an audit of every knowledge source. What held: nothing found is ever run (strace and Node's permission model), nothing uses the network, scans are deterministic, and no crash was seen on any repository.

Fixed, each with tests:
- **Secrets:** server addresses are redacted wherever they identify a server (out-of-policy findings, hook answers, the policy init writes, policy matching); new shapes: Slack webhooks, Telegram bot tokens, Azure account keys, passwords in addresses new URL cannot read, key-like path segments. The hook denies a secret given to claude mcp add with -e or -H.
- **Evasion and denial of service:** linear JSONC stripping (2 min 39 s to 0.2 s for 2 MB); configuration nested too deep and folders padded past the entry limit now fail the scan (too-deep, too-many-entries); doctor no longer reads through links out of the project; a large tree is walked once (37 s to 9 s for 99,000 folders); invisible characters are escaped in the lock and the policy.
- **Hook:** any command that names an agent file gets ask unless it only reads (curl -o, dd of=, python -c, git checkout --, quoted names, agent folders), with no question for plain words or cd; a here-document is data unless a shell runs it; oversized tool calls, edits of agent files over 2 MB and calls under an invalid policy are denied; write tools it cannot read ask; a bare skills add is checked.
- **Rules:** persistence-instruction lost most false alarms (20 of 24 in the field test); broad-shell-permission finds Bash(npx *), Bash(node:*) and other runners; permission-bypass sees settings it never inventoried (enableAllProjectMcpServers, enabledMcpjsonServers) and reports acceptEdits at medium; hooks in skill and subagent frontmatter are not auto-run; Codex SessionStart hooks are.
- **Knowledge:** 25 discrepancies from the source audit, each checked against the page read that day (D-034).
- **doctor:** a 13th check, unknown-hook-event.
- **CLI and outputs:** a valid policy exception wins over an expired one; SARIF paths are percent-encoded; a missing directory and an unknown rule exit with 2; -h scan shows the help of scan; per-finding levels are documented and shown by explain; the output schemas accept new fields, as the docs promise; exception rules must be known rule ids.
- **MCP:** unknown arguments are errors, every line is held to the 1 MB limit, and a missing path outside the server's folders is answered as one that exists.
- **Action:** no SARIF is written or uploaded on exit 2; fail-on levels are documented per command; the action test also runs on main.

Not changed, for the maintainer (Q-015, Q-016): the lock's hash of a server entry still covers secret values, and several kinds of configuration are not read yet.

## 2026-11-07: Release commit for 1.0.0

- The maintainer asked for the release commit: `package.json` and `package-lock.json` hold 1.0.0, `CHANGELOG.md` has the 1.0.0 notes, and README no longer says the package is unpublished. The tag and the publish are the maintainer's, by docs/RELEASING.md. `npm view agentcurfew` answered E404 on 2026-11-07, so the name is still free (Q-002).
- The action installs the version of its commit from npm, which 1.0.0 is not yet, so its own test now builds from source with the new input `build-from-source`.
- Q-012 is written up for depcurfew's session in docs/handoff-depcurfew.md.

## 2026-11-07: Windsurf deprecations, TypeScript stays

- The maintainer opened the session's network, so docs.devin.ai could be read at last (Q-011). The Windsurf (Devin Desktop) knowledge now lists `.windsurfrules`, `.windsurf/rules/*.md`, `.windsurf/global_rules.md`, `.windsurf/skills` and `.windsurf/workflows` (with the Windsurf system workflow directories) as deprecated, each with the page and quote; `doctor` warns about them. The notes on hooks and workflows cite the Cascade reference, which says Cascade no longer starts conversations.
- The maintainer keeps TypeScript 6.0.3 for 1.0.0 (Q-005).

## 2026-11-07: Node 22 required

- The maintainer chose Node 22 as the floor (D-033, Q-014): `engines` is `>=22.23.0`, the release CI tests, and the smoke test runs on Node 22, 24 and 26. README and the release notes say Node.js 22.23.

## 2026-11-07: Node 18 dropped

- The maintainer dropped Node 18 (D-032): `engines` is `>=20.20.0`, the smoke test runs on Node 20, 22, 24 and 26, and README and the release notes say Node.js 20.20. Node 20 ended on 2026-04-30 too, by the official schedule, so Q-014 asks whether to drop it as well.

## 2026-11-07: Unchecked files fail the scan

- The maintainer chose Q-013 option (b), recorded as D-031: `scan` exits with 1 when a file could not be read (`too-large`, `too-deep`, `unreadable`), says so in the text output, and marks the SARIF run as not successful with one notification per file. `--fail-on none` turns it off.
- The hook asked "too long and repetitive" about ordinary command lines with many short commands, such as a script with many parentheses, because the first word of every command counted against its limit of 32 tries. Only later starts count now; tests cover both.

## 2026-11-07: A second review, of the hardening itself

A fresh read-only review of the fixes above found eleven more problems and a latent one; all were reproduced and fixed with tests.

- **The read budget hid files (high).** Filler of 64 × 2 MB `CLAUDE.md` files used up the 128 MB budget before `.vscode/tasks.json` and `.cursor/mcp.json` were read, so `scan` passed, and the hook asked instead of denying. Fixed paths of the knowledge base (no wildcard) and the text of a write no longer count against the budget; only walked trees and globs do. The hook now denies whenever the scan with the new text has a problem on the file or a folder above it, also one the old file had.
- **Links the hook did not follow (high).** A write to the file an agent file links to, a write through a link whose target does not exist yet, and `..` after a linked folder were not checked. `physicalPath` reads every link on the way as the file system does, and each project path of the knowledge base is resolved up to its first wildcard and compared with where the write lands.
- **Unchecked new text (medium).** JSON nested deeper than the parser goes is valid for an agent but was only asked about; a `.claude` that links out of the project gave "nothing new". Both are denied now. A new folder spelled in another case on Windows or macOS is checked as the knowledge base spells it, not only asked about.
- **More wrappers (medium).** `nice -n 5`, `timeout 60`, `time -p`, `exec -a x`, `stdbuf -oL`, `bash -c -- '…'`, `pwsh -Com` and `npx -p skills skills add` hid installs and launchers; after an unknown wrapper, `launch()` and the hook look from the first launcher word, so such a server is no longer taken for a local command. `cmd /c` scripts keep their backslashes. Both searches are capped, so a padded command stays linear.
- **Secrets (medium).** Any value starting with `/` was taken for a file path, which hid base64 secrets; now only `./`, `../`, `~/` and drive paths, or keys that name a file, path, address, variable or type, are exempt, which also ends false positives such as `--auth-server-url https://…` and `--api-key-env OPENAI_API_KEY`. Credentials in an address inside a longer word (`--db=postgres://u:pw@h/db`) are redacted in the lock. `ghs_` tokens are matched with any three dotted parts again, in linear time. The shapes are compiled once.
- `Locator` counted a column too many after an index between the halves of a surrogate pair; no rule produced one yet.
- 447 tests and 10 fuzz properties pass, with typecheck, `check:pkg`, the smoke test and the self-check.

## 2026-11-07: No `acf` alias

- The maintainer dropped the `acf` alias (D-030, answering Q-001): the package ships only the `agentcurfew` binary, the help text no longer names `acf`, and a test checks that.

## 2026-11-07: Before 1.0.0, a bug review

A read-only review of the whole code base for hostile input found eleven problems; each was reproduced, fixed with a test, and one more was found while measuring.

- **Quadratic patterns (high).** Several regular expressions read to the end of a run of text from every start, so padding stalled `scan`, `lock` and the hook: 200 KB of `eyJ-` in one MCP argument took 39.6 s, 200 KB of zero-width spaces took 390 s in `hidden-unicode`. Fixed: JWTs and GitHub's `ghs_` tokens are read from the start of each run of token characters (`dottedTokens`); the digit of an `sk-` key is checked after the match; addresses in `secret-in-config` start at the start of a run; `curl … | sh`, base64 and openssl decoding, encoded PowerShell and `cp`/`mv` writes look at the first word of each pipeline stage or line only; `redact` finds the end of each word once; line and column come from a `Locator` that finds line starts once and counts columns on. The same case now takes 0.2 s, and 0.3 s at the 2 MB file limit. `tests/rules/linear.test.ts` times hostile input on every pattern and rule; `tests/fuzz/patterns.fuzz.ts` checks that the new patterns find what the old ones found, except that a newline is no longer taken for a space inside a command.
- **Hook: new skill folders (high).** The overlay listed a written file only in its own folder, so a Write that created `.claude/skills/new/SKILL.md` was never scanned and got "nothing new". Overlaid files now show up in every folder above them; a hook fixture writes a new skill with Tag characters and is denied.
- **Secrets in separate arguments (high).** `--api-key VALUE` as two words, `--token VALUE` in a command string and `https://TOKEN@host` were neither reported nor redacted, so they went into `agentcurfew.lock` in plain text. `secret-in-config` and the lock now handle them; values that point at a file (`./pass`, `~/.token`) are not taken for secrets. `redact` replaces a value where it stands, not its first occurrence.
- **Hook: padding, case and links (medium).** A write over the 2 MB read limit, or one the scanner reports as too deep, is now denied instead of passing as "nothing new". The path of a write is followed through links inside the project and, on Windows and macOS, spelled as on disk, so `.CLAUDE/settings.json` and a link to `.claude/settings.json` are checked as that file.
- **Wrapped commands (medium).** `cmd /c npx -y server`, `sh -c "…"`, `env X=1 …`, `sudo …`, `CI=1 …`, `(…)` and `$(…)` hid the launcher from `unpinned-mcp-server`, the lock's package and `mcp.allowServers`, and hid `npx skills add` and `claude mcp add` from the hook. `src/rules/command-words.ts` takes the wrappers off for both.
- **`init --hook` through a linked `.claude` (medium).** Every part of `.claude/settings.json` is now checked for a link, so a cloned repository cannot point the hook into `~/.claude`.
- **Memory (medium).** A scan reads at most 128 MB in all (`maxTotalBytes`), and each file once, also when several agents read it.
- **Output (low).** Key names of an invalid policy are quoted and cut short in MCP and CLI errors.
- 441 tests and 10 fuzz properties pass; `typecheck`, `check:pkg`, the smoke test and the self-check pass.

## 2026-11-06: Before 1.0.0, hardening

- CI on Windows and macOS (`test-os`) found three problems, now fixed: the MCP server compared resolved paths with folders that were not resolved, so it refused its own folder where the temporary folder is a link (macOS `/var` is `/private/var`; Windows short names); git turned LF into CRLF on Windows checkouts, which broke the checksums of the SARIF schema and of a `skills-lock.json` fixture, so `.gitattributes` now keeps every file's bytes (`* -text`). A test runs the MCP server through linked folders.
- `agentcurfew verify` failed on a large project, whose lock is over the old 2 MB read limit: the lock limit is now 64 MB, with a test of a 30,000-component lock.
- Credential formats checked against their issuers (Q-010): GitHub's new stateless installation tokens, GitLab routable tokens, Slack `xoxe-`/`xapp-`/`xwfp-`, npm's own token pattern, more private key labels and Google keys ending in `-` are now found; `sk-` keys need a digit. Each shape names its source.
- Faster scans: a file's type is read once, not once per glob that reaches it, and `scan` builds the inventory once instead of twice. On this repository, scan and lock went from 5.6 s to 2.7 s.

## 2026-11-06: Phase 8, depcurfew

- `src/depcurfew/bridge.ts` calls depcurfew's public API (1.5.2, optional peer, dynamic import) offline: a `fetch` that refuses every request, the project's `depcurfew.json`, and only the findings that need no registry (D-028). The new rule `mcp-package` reports them for MCP servers started through npx, uvx and the like.
- `analyzeProjectAsync` gathers depcurfew's reports before the rules; `scan`, `lock` and the MCP tools use it.
- `doctor` checks `depcurfew-hook-missing` and `depcurfew-hook-broken` (D-029).
- depcurfew 1.5.2 as a dev dependency; CI runs `depcurfew doctor` from it. Tests with and without depcurfew, with another major version and a broken `depcurfew.json`, a test that no depcurfew code is bundled and that no package-check logic exists outside the bridge. 386 tests.
- Q-012 lists what depcurfew's API lacks for more: its popular names and the folder of its local OSV.dev data.
- The new doctor check found that this repository had no depcurfew hook: `.claude/settings.json` now has depcurfew's and agentcurfew's hooks and a SessionStart install, with a policy exception for that auto-run and a new lock.

## 2026-11-06: Phase 7, MCP server and hook

- `acf mcp`: an MCP server without the SDK, speaking 2026-07-28 and 2025-11-25, with the read-only tools `scan_project`, `check_skill`, `check_mcp_config` and `explain_rule`, limited to its folder, `--root` folders and the client's roots (D-025). Tested with the official TypeScript client in both eras, plus raw JSON-RPC, stdio streams and fuzzing.
- `acf hook`: a Claude Code PreToolUse hook that asks before writes to files that steer agents, denies them when the new text is dangerous or out of the policy, and checks `npx skills add` and `claude mcp add` against the policy (D-026). The new text is scanned as an overlay, never written. 18 fixtures with hand-written decisions.
- `acf init --hook` adds the hook to `.claude/settings.json` next to depcurfew's hook, which a test keeps byte for byte in structure (D-027); `doctor` has a tenth check, `agentcurfew-hook-missing`.
- Knowledge: Claude Code's PreToolUse input and output, `claude mcp add`, and `npx skills add`; `docs/knowledge.md` lists them.
- `@modelcontextprotocol/client` 2.4.0 as a dev dependency for the tests. `docs/mcp.md`, README.

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
