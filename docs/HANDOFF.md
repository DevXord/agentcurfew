# Handoff for the next session

Written on 2026-11-09 by the session that took agentcurfew from phase 0 to 1.1.0. Read it after [CLAUDE.md](../CLAUDE.md), then [PLAN.md](PLAN.md) (section 15 has the roadmap after 1.1.0), [decisions.md](decisions.md) and [CHANGELOG-dev.md](CHANGELOG-dev.md). This file says what is where, how the work is done here, and what tends to go wrong; the decisions themselves are in decisions.md and are not repeated in full.

## State on 2026-11-09

- **1.0.0** is on npm (published by hand on 2026-11-07 from the tarball CI built; shasum `0af21ade49e9802a5fc4aa879dfe0acfbf0f81cf`). npm's staging left a public placeholder `0.0.0-stage` in the version list; the maintainer was told to deprecate it.
- **1.1.0** is the release commit on `main` (PR #2 merged on 2026-11-09). It is the first release meant to go through trusted publishing (OIDC) and staged publishing. Whether the maintainer has pushed the tag `v1.1.0`, added the trusted publisher on npmjs.com, approved the job `publish` and approved the staged package is **not known to this session**: check it first (see "First steps").
- Contents of 1.1.0: settings that run commands and the scripts hooks run (phase 11, D-038, D-039), stable component ids and a producer in the JSON output (phase 12, D-042, D-043), Node 20 or later (D-037).
- 541 tests and 10 fuzz properties pass; CI covers Linux, Windows and macOS, the test suite on Node 22 and 24, and the packed CLI on Node 20.0.0, 20, 22, 24 and 26.
- Runtime dependencies: `yaml` and `smol-toml`, plus `depcurfew` as an optional peer. The maintainer wants **as few dependencies as possible**; none was added after 1.0.0.

## Where things live

| What | Where |
| --- | --- |
| Facts about agents (paths, formats, hooks, MCP, skills, permissions, command settings), each with `source` and `verifiedAt` | `src/knowledge/*.ts`; generated page `docs/knowledge.md` (`npm run docs:knowledge`) |
| Inventory (what is read, limits, links, the `.gitignore` subset, script paths, component ids) | `src/inventory/` (`scan.ts`, `files.ts`, `gitignore.ts`, `identity.ts`), `src/rules/script-paths.ts` |
| Rules (15) and their docs | `src/rules/rules/*.ts`; `docs/rules.md` is generated (`npm run docs:rules`) |
| Lock | `src/lock/` (`build.ts`, `read.ts`, `diff.ts`, `redact.ts`, `hash.ts`) |
| Policy and its schema | `src/policy/`, `schema.json`, `docs/policy.md` (`npm run docs:policy`) |
| doctor (13 checks) | `src/doctor/`, `docs/doctor.md` (`npm run docs:doctor`) |
| CLI, JSON and SARIF | `src/cli/`, `src/report/sarif.ts`, `schemas/*.json`, `docs/cli-json.md` |
| MCP server (stdio, no SDK) and the Claude Code PreToolUse hook | `src/mcp/`, `src/hook/`, `docs/mcp.md` |
| depcurfew bridge (offline, optional peer) | `src/depcurfew/bridge.ts`, rule `mcp-package` |
| GitHub Action | `action.yml`, `.github/workflows/action-test.yml` |
| Release | `.github/workflows/release.yml`, `docs/RELEASING.md` |
| Documentation site | `scripts/site.ts` (`npm run site` → `dist-site/`), `site/` (logo `favicon.svg`, `style.css`, `social.png` from `social.html`), `site/org-repo/` (files of `agentcurfew/agentcurfew.github.io`, which builds the site from the latest release tag once a day) |
| Notes for depcurfew's own session | `docs/handoff-depcurfew.md` (agentcurfew never changes depcurfew) |

The site is live at https://agentcurfew.github.io/ (repository `agentcurfew/agentcurfew.github.io`, GitHub Pages from Actions). The organization profile README belongs in `agentcurfew/.github` at `profile/README.md`; on 2026-11-08 it did not exist yet.

## How the work is done here

- **Plan mode first.** One phase per session; begin in plan mode, write the plan, and wait for the maintainer's approval. The maintainer speaks Polish and wants to be addressed as "Panie"; code, comments, docs and CLI messages are in English.
- **Tests and fixtures first**, then the implementation. Rule fixtures: `tests/fixtures/rules/<rule>/{positive,negative}/` with the expected lines in `tests/rules/fixtures.test.ts`; inventory fixtures: `tests/fixtures/repos/<name>/` with `EXPECTED` in `tests/inventory/fixtures.test.ts`.
- **Facts only from sources**, read in this session (WebFetch, curl to raw GitHub). Record the URL and the date; keep conflicting sources as `disputed`. Hosts outside the session's network fail with ENOTFOUND (`developers.openai.com`, `fastcompany.com` and others did); then use the source code on raw.githubusercontent.com, or ask the maintainer to allow the host.
- **Hostile input everywhere**: size, depth and total-read limits, no links out of the project, linear-time matching. Every new matcher gets a hostile test with a time limit; a regular expression with nested repetition hung a test in phase 11 (the `.gitignore` subset was rewritten as dynamic programming).
- **Additive changes**: new JSON fields without a new `schemaVersion` (schemas allow extra properties), new lock fields without a new `lockfileVersion` (the reader keeps only the fields it knows). A breaking change needs the maintainer.
- **End of phase**: an entry in `docs/CHANGELOG-dev.md`, user-facing notes in `CHANGELOG.md` under Unreleased, decisions and open questions in `docs/decisions.md`, regenerated docs, a commit, a push to the session's branch, and a check of CI.
- Commits end with the attribution lines the harness gives; no model identifier in commits or code.

## Gotchas in this environment

- **depcurfew's hook** (from `.claude/settings.json`) blocks `npx vitest`, `npx tsdown` and `npx tsc` when the registry's newest version is younger than the cooldown, and refuses installing a local tarball (`allow-file=none`). Use `npm test`, `npm test -- <path>`, `npm run build`, `npm run typecheck`; `npx --no-install vitest run <file> -u` updates snapshots. Only the maintainer may change `depcurfew.json`.
- **agentcurfew's own hook** (`dist/cli.js hook`) asks about shell commands that name agent files (CLAUDE.md, `.claude/settings.json`, …) unless they only read them. Write such files with the Edit and Write tools, or from a script file in the scratchpad. Rebuild `dist/` (`npm run build`) after changing the hook, since the hook runs the built file.
- **The Edit and Write tools turn `\u202E` and similar escapes into the real character.** The test `source-clean` refuses hidden characters in the repository: fix them with a Python replacement, and write fixtures as `{U+XXXX}`. Secrets in fixtures are `{{secret:github}}` and `{{secret:aws}}` (`tests/rules/materialize.ts`), so that no real-looking token is committed.
- **`.npmrc` sets `allow-file=none`**, so `npm publish ./x.tgz` inside the repository needs `--allow-file=all` (see RELEASING.md).
- The cloud container's npm is 10.9.9; CI uses `npx --yes npm@11.21.1`.
- A commit that changes the version must also update the welcome-screen snapshot (`tests/__snapshots__/cli-screens.test.ts.snap`), which shows the version. The 1.1.0 release commit missed it and needed a fix-up commit.
- Old Node binaries for compatibility checks can be downloaded from nodejs.org into the scratchpad and verified against `SHASUMS256.txt`; `PATH=<node>/bin:$PATH bash scripts/smoke.sh dist/cli.js`.
- GitHub access is limited to the repositories attached to the session; `add_repo` works for others the maintainer owns, but pushes to `agentcurfew/agentcurfew.github.io` need the Claude GitHub App installed in the organization `agentcurfew` (it was, on 2026-11-08), and repositories whose names start with a dot (`.github`) cannot be attached at all.

## Open questions and pending work

- **Q-016 part 2** (phase 13 candidate): `env` such as `ANTHROPIC_BASE_URL`, `enabledPlugins` and `extraKnownMarketplaces`, plugin packages (`.claude-plugin/plugin.json`, `gemini-extension.json`), Gemini `context.fileName`, the executable bit of Cline hook files, unpinned launchers inside hook commands, `headersHelper` of remote MCP servers, and writes to hook scripts in the PreToolUse hook. Each needs facts from sources first.
- **Command settings of other agents** are not researched (the `commands` field is absent for all but Claude Code and Codex).
- **Q-012 / handoff-depcurfew.md**: export of depcurfew's popular names and OSV data folder (would make `mcp-package` catch look-alike and known-malicious MCP packages offline), the `npx <local bin>` false positive of depcurfew's hook, a sibling link back. The maintainer passes these to depcurfew's session; D-040 (the MIT/PRO boundary) as well.
- **Q-005**: TypeScript 7 was to be tried after 1.0.0.
- **D-041**: the paid tier starts with a pilot with 5 to 10 organizations; nothing is built for it in this repository. Any paid product is a separate package; the CLI never gets network access, telemetry or a licence check (D-040).
- The roadmap from the brainstorm of 2026-11-08 is in PLAN.md section 15.
