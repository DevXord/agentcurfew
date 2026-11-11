# Changelog

All notable changes to agentcurfew are written here for its users.

## Unreleased

- The notes of 1.2.0 on Gemini CLI's `context.fileName` are corrected: a name agentcurfew does not follow gives the problem `not-followed`, not `unparsable`, and a name with a leading slash is read in the folder.
- README pins the GitHub Action to the commit of v1.2.0.
- README has a section on trademarks: the names of agents and tools in it belong to their owners, and agentcurfew is not affiliated with or endorsed by any of them. The documentation site shows it on its start page.
- The hook closes bypasses of 1.2.0, found by the review and verification of 2026-11-10:
  - PowerShell commands are read with PowerShell's quoting, and paths with `\` count: `Set-Content -Path .claude\settings.json`, `Copy-Item x .claude\settings.json` and eight more spellings got no answer. `cmd /c` is read with cmd's caret (`.cl^aude`), and Bash commands as bash reads them (`$'\x43LAUDE.md'`, a backslash before a newline, backslashes inside double quotes).
  - The `Monitor` tool, which runs commands like Bash, is checked; `init --hook` writes the matcher `Bash|PowerShell|Monitor|Write|Edit|NotebookEdit`. Widen the matcher of a hook installed earlier by hand.
  - The guards cannot be switched off without touching their entries. A write is denied when it makes a guard run in the background (`async`, `asyncRewake`), drops its `onFailure: "block"`, narrows its matcher, points it at a copy outside the project's install, or sets a timeout under 20 s for agentcurfew's guard (its scans take up to 15 s). Guards count only in the project's settings files, not in a skill. A write of `~/.claude/settings.json` that sets `disableAllHooks` is denied while the project has working guards and does not set it back to `false`. A write of the guards' installed code is denied, and of `depcurfew.json` asked about; so are shell commands that remove agentcurfew or depcurfew, or run `agentcurfew lock`, `agentcurfew init`, `depcurfew apply` or `depcurfew init`.
  - `skills add` is recognized through `npm x`, `npm exe`, global options, `pnx`, `pn dlx`, the `add-skill` program and the CLI's other names (`a`, `install`, `i`, `use`), every source is checked, and its options are read as the CLI reads them; commands that update, sync, restore or remove skills ask. Launchers and `claude mcp add` count also with a path, in capitals or with `.cmd` or `.exe` (`npx.cmd`, `/usr/bin/npx`, `claude.exe`).
  - `claude mcp add` reads `--client-id`, `--callback-port`, `--option=value` and several `KEY=value` after `--env`, so the server's name and address are no longer misread, and a token in a later `--env` value is checked.
  - The hook's answers mask secrets: a token in a skill source, in a server name or in a launcher's package was quoted in full. The messages of `unpinned-mcp-server` and `unpinned-launcher` redact the package they quote.
  - Commands that move into an agent folder before writing count also with `cd -P`, `cd --`, `pushd`, `Set-Location`, `env -C`, `sudo -D` and paths such as `~/.claude`; `rm -rf .CLAUDE`, globs of folders (`mv .c*e/ x`), `sed -Ei`, a file kept in a variable (`F=CLAUDE.md; echo x > $F`) and a loop over an agent folder ask.
  - PowerShell cmdlets that only read (`Get-Content`, `Select-String`, `Get-ChildItem`, `Test-Path` and their aliases) no longer ask.
- `unpinned-mcp-server`, `unpinned-launcher` and `broad-shell-permission` know `pnx` (pnpm dlx) and `pn` (pnpm), and `--cpu`, `--os` and `--libc` take a value, so `pnpm dlx --os linux some-cli@1.0.0` starts `some-cli@1.0.0`. A server started through `pnx` gets a package identity: `agentcurfew lock` records it.
- The knowledge base records facts about the tools the hook reads (PowerShell, pnpm, npm, the skills CLI, `env` and `sudo`, depcurfew), each with its source.

## 1.2.0

- Settings that redirect the agent or bring code into it are read, as components of the new kind `setting`: each variable of Claude Code's `env` block, each plugin `enabledPlugins` turns on or off, each marketplace of `extraKnownMarketplaces` (also written `additionalMarketplaces`), and Gemini CLI's `context.fileName`.
- New rule `env-override` (high): an `env` variable in a project file that sends Claude Code's requests to another host (`ANTHROPIC_BASE_URL` and the Bedrock, Vertex, Foundry and Claude Platform on AWS endpoints, `HTTP_PROXY`, `HTTPS_PROXY`), adds headers to them (`ANTHROPIC_CUSTOM_HEADERS`) or wraps every command (`CLAUDE_CODE_SHELL_PREFIX`). Low in user files and for variables current versions ignore in a project file.
- New rule `plugin-marketplace` (medium): a marketplace registered from GitHub, git or an address, high with `autoUpdate` or over plain `http://`; low for a local path and for a plugin a project file turns on.
- New rule `unpinned-launcher` (medium): hooks, automatic tasks, settings that run a command and the scripts they run that start a package through `npx`, `uvx`, `docker run` and the like without an exact version or digest. `npx --no-install` and `npm exec --no` are not reported.
- `headersHelper` of a remote MCP server and of a marketplace `url` source, and `CLAUDE_CODE_SHELL_PREFIX`, are settings that run a command (`command-setting`), so `dangerous-hook-command`, `secret-in-config` and `unpinned-launcher` check them, and the scripts they run are read and locked.
- Gemini CLI's `context.fileName` names context files that are now read where `GEMINI.md` is, besides `GEMINI.md` itself. A name with a leading slash is read in the folder, as Gemini CLI joins it (`/.prompts/x.md`); a name from home or a drive, or with `..`, wildcards, a backslash or hidden characters, is not followed, and the settings file is reported with the new problem `not-followed`, a warning.
- `secret-in-config` checks `env` values and marketplace headers by their names.
- The hook asks before a write to a script that a hook, a task or a setting runs, or to a context file a setting names, and denies it on the same terms as a write to an agent file, so a hook script that starts to download and run code is refused; a shell command that names such a file and does not only read it is asked about.
- The hook denies a write to the project's Claude Code settings (`.claude/settings.json` or `.claude/settings.local.json`) that sets `disableAllHooks`, removes the depcurfew hook from a project with `depcurfew.json`, or removes the agentcurfew hook, since the agent would switch off the checks of its own writes and installs; such a change is made by hand. `disableAllHooks` is inventoried as a setting.
- New `doctor` check `hooks-disabled`: `disableAllHooks` true in a project settings file turns off every hook of the user and the project for everyone who opens the repository; an error when the same file holds the depcurfew or agentcurfew hook.
- Fixed, found by a review of 1.1.0 (each also in 1.1.0 unless noted):
  - A hook command with a very long script path made the `.gitignore` match take quadratic time: a 7 KB settings file took 10 s and 160 KB took 50 s. Script paths are now read only up to the limits of common file systems (4096 characters, names of 255, 64 folders), and a path is matched once per pattern.
  - Thousands of nested here-documents (`bash <<A` repeated) overflowed the stack, so `scan` stopped with an error, and the hook gave no opinion on such a shell command, which let any command it would deny through. Here-documents are read to a depth of 8, past which their lines are read as plain commands, and the hook now asks when its own check fails, for shell commands too.
  - `unpinned-launcher` (new, not in 1.1.0) and `unpinned-mcp-server` missed `npm x`, global options before the subcommand (`npm --yes exec`, `docker --context x run`), every `-p` but the last, packages added with `uvx --with`, and options of npm and docker whose value was taken for the package (`--node-options`, `--cidfile`, `--volumes-from` and others). `npx -y pkg --no` no longer passes as `--no-install`: only options before the package count.
  - An MCP server named like its file (`.mcp.json` in `.mcp.json`) was read as the whole file, so no rule checked its entry and the lock had no `server` details for it.
  - The new guard of the hook counted a guard hook by its command string only, so a write that kept the string but stopped the hook from acting (a matcher that never fires, the hook moved to `PostToolUse`, a decoy handler, a tiny timeout) was only asked about. A guard now counts only when it can act. (Not in 1.1.0, which had no such guard.)
  - Shell writes to an agent file spelled with a glob or braces (`cp x CLAUD?.md`, `tee .claude/settings.jso{n,x}`), or named by another command (`printf x > $(echo CLAUDE.md)`, `xargs`), passed the hook without a question.
  - A repository padded with tens of thousands of skill folders made the hook's two scans of a write take longer than the 30 s timeout of `init --hook`, after which Claude Code lets the call through. The hook's scans now have a budget of 15 s, and it asks when the project is too large to check in time.
  - An own `__proto__` key in an MCP server's `env` or `headers` became the prototype of the merged entry and hid the variables below it from `secret-in-config`.
- Fixed, found by a functional review of 1.1.0 (each also in 1.1.0):
  - A server that a launcher fetches from git or an address (`npx -y github:org/repo`, a tarball URL, `uvx --from git+https://…`) counted as a server started from a local command, so `mcp.allowServers: ["local"]` allowed it, the hook asked about `claude mcp add` of it instead of denying, and `init` wrote `local` for it. Such a server is now named by its spec.
  - `verify` passed when a file could not be read (too large, too deep, a link out of the project); it now fails as `scan` does, with `ok: false`.
  - `remote-instructions` missed `curl -fsSL https://… | sh`, `wget -qO- https://… | bash` and `eval "$(curl -s https://…)"` in skill scripts: options between the program and the address hid it.
  - `scan` says in a note, and in `depcurfew` of its JSON, when `mcp-package` did not check the packages of MCP servers because depcurfew is missing, unsupported or has no valid `depcurfew.json`.
  - The hook did not ask about `rm -rf .claude`, `cp -r x/. .claude/` and `cd .claude && echo x > settings.json`. `init --hook` now also matches `PowerShell` and `NotebookEdit` (PowerShell commands are read like Bash commands), and a guard hook with an `if` condition does not count as working.
  - Findings of `out-of-policy` and `mcp-package` carry the `componentId` of the component they name.
  - SARIF placed files of the home folder (`--user`) under the repository; they are now relative to `HOME`, and machine files are absolute.
  - The action uploaded an empty SARIF file when the policy was invalid.
  - `mcp --root` with a folder that does not exist exits 2, as other wrong input does.
- Fewer false alarms and misses, found by a field test on 34 public repositories:
  - `broad-shell-permission` reports `Bash(npx*)` and the like, a runner with a wildcard joined to it, and no longer reports a runner whose entry fixes the program it runs (`Bash(pnpx vitest:*)`, `Bash(xargs kill:*)`).
  - `dangerous-hook-command` skips comment lines of scripts, and an assignment of a download's output (`V=$(curl …)`) is reported as a network connection, not as running the download.
  - `remote-instructions` leaves requests to this machine alone (`localhost`, `127.0.0.1`, `::1`).
  - `obfuscated-content` no longer takes a long paragraph of prose for a minified line.
  - `unpinned-mcp-server` leaves a server alone that npm runs only from what is installed (`npm exec --no`, `npx --no-install`), as `unpinned-launcher` does.
  - Scripts that hooks run through `${CLAUDE_PROJECT_DIR:-…}/…`, and Gemini CLI hooks through `$GEMINI_PROJECT_DIR`, are read and locked.
- README: in a project with a release-age delay, `npx agentcurfew@<version>` fails until the version is older than the delay; install it as a dev dependency or use the GitHub Action.
- `verify` skips components of a kind it does not know, with a note and `unknownKinds` in its JSON, instead of refusing the whole lock. agentcurfew 1.1 refuses a lock that holds `setting` components, so upgrade every copy that verifies the same lock together.
- After upgrading, run `agentcurfew lock` once: the lock gains the new components. No `schemaVersion` or `lockfileVersion` changed, and no dependency was added.

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
