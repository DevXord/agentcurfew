# MCP server and hook

## `agentcurfew mcp`

An MCP server over stdio, so that an agent can check a skill or an MCP server **before** it installs it. Every tool only reads files; nothing it finds is run, and nothing is sent anywhere.

| Tool | Arguments | What it does |
| --- | --- | --- |
| `scan_project` | `path` (optional) | The whole scan of a project, with its policy: findings, accepted findings, problems. |
| `check_skill` | `path` | One skill folder with `SKILL.md`, for example one just downloaded: hidden characters, dangerous or obfuscated scripts, instructions fetched at run time, persistence instructions, broad tool grants, and the project's policy. |
| `check_mcp_config` | `config`, `name` (optional) | One server definition, or a map of servers as in `.mcp.json`: unpinned packages, plain HTTP, secrets written into it, hidden characters, and `mcp.allowServers` of the policy. Secrets are masked in the answer. |
| `explain_rule` | `id` | What a rule finds, its OWASP references and its fix. |

Each tool has the annotations `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` and `openWorldHint: false`, and an input schema that allows no other arguments. Results have a text part and the same findings as `structuredContent`; a problem with the arguments or the path is a result with `isError: true`.

**Paths.** The tools read only inside the folder the server was started in, the folders given with `--root` (repeatable), and the roots the client shares under MCP 2025-11-25. Links are resolved first, so a link cannot lead outside. Under 2026-07-28 roots are deprecated and informational, so they are not asked for.

**Protocol.** The server speaks MCP 2026-07-28 (`server/discover`, the version and capabilities in the `_meta` of each request, `resultType` on results) and 2025-11-25 (`initialize`, `ping`, `roots/list`), so current and older clients can use it; a client that asks for 2025-06-18 is answered in 2025-11-25. An argument a tool's input schema does not list is an error. An unknown version gets error -32022 with the supported list. Messages are one JSON object per line on stdout, nothing else is written there, a line over 1 MB is refused, and the server ends when stdin closes. It is written without the MCP SDK, which would bring runtime dependencies; the tests connect the official TypeScript client (`@modelcontextprotocol/client`) in both eras.

**Setting it up.** For Claude Code, in `.mcp.json` of the project, with agentcurfew installed as a dev dependency:

```json
{
  "mcpServers": {
    "agentcurfew": {
      "command": "node",
      "args": ["node_modules/agentcurfew/dist/cli.js", "mcp"]
    }
  }
}
```

Other agents take the same command and arguments in their own MCP file (see [knowledge.md](knowledge.md) for where each agent reads it).

## `agentcurfew hook` for Claude Code

A `PreToolUse` hook on `Bash`, `PowerShell`, `Monitor`, `Write`, `Edit` and `NotebookEdit`. It reads the call on stdin and answers in `hookSpecificOutput`:

| Call | Answer |
| --- | --- |
| `Write` or `Edit` of a file that steers an agent (every project path of the knowledge base: `CLAUDE.md`, `AGENTS.md`, `.mcp.json`, `.claude/settings.json`, skills, subagents, commands, rules and the others), or of `agentcurfew.policy.json`, `agentcurfew.lock` or `skills-lock.json` | `ask`, with the agents it steers and what the rules found in the new text |
| the same, when the new text brings a finding at high or above, or one of `out-of-policy` | `deny`, with the findings |
| the same, when the new settings set `disableAllHooks`, or leave no working depcurfew hook in a project with `depcurfew.json`, or no working agentcurfew hook, or make a working guard cover fewer of `PowerShell`, `Monitor` and `NotebookEdit` (for depcurfew: `PowerShell`, `Monitor`), or drop its `onFailure: "block"`: a guard counts only as a `PreToolUse` hook in `.claude/settings.json` or `.claude/settings.local.json` (not in a skill or subagent), whose matcher covers its tools (`Bash` for depcurfew; `Bash`, `Write` and `Edit` for agentcurfew), whose handler runs the project's own install of the guard and nothing else (`node ${CLAUDE_PROJECT_DIR}/node_modules/<guard>/dist/cli.js hook` or `check … --hook`, depcurfew also from `.claude/depcurfew/`, or the binary), that does not run in the background (`async`, `asyncRewake`), and whose timeout is at least 20 s for agentcurfew (its scans take up to 15 s) or 10 s for depcurfew | `deny`: the agent would switch off the checks of its own writes and installs; make such a change by hand |
| `Write` or `Edit` of the installed code of a guard (`node_modules/agentcurfew/`, `node_modules/depcurfew/`, `.claude/depcurfew/node_modules/depcurfew/`) | `deny` |
| `Write` or `Edit` of `depcurfew.json` | `ask` |
| a write of `~/.claude/settings.json` that sets `disableAllHooks` while the project has working guards and its own settings do not set it back to `false` | `deny` |
| the same, when agentcurfew cannot read the new text: larger than it reads (2 MB), nested deeper than it parses, not parsable, or behind a folder that links out of the project | `deny` |
| a new `agentcurfew.policy.json` that breaks the schema | `deny` |
| `Write` or `Edit` of a script of the project that a hook, an editor task or a setting runs (`bash .claude/hooks/fmt.sh`, an `apiKeyHelper` or `headersHelper` script), or of a context file a setting names (Gemini CLI `context.fileName`), also one that does not exist yet | `ask`, with what runs or reads it; `deny` on the same terms as above, so a script that starts to download and run code is refused |
| a write to a file in the user's home that steers an agent | `ask` |
| `npx skills add <source>` (also `pnpm dlx`, `pnx`, `pn dlx`, `bunx`, `yarn dlx`, `npm exec`, `npm x`, the `skills` and `add-skill` programs, with any path or `.cmd`; and the CLI's other names `a`, `install`, `i` and `use`), with every source it names, read as the skills CLI parses its options | `deny` when `skills.allowSources` does not allow a source, otherwise `ask` |
| a skills command that changes the installed skills without a source to check (`update`, `upgrade`, `sync`, `experimental_install`, `install` without a source, `remove`, `init`), or `add` whose source agentcurfew cannot tell | `ask` |
| a command that removes agentcurfew or depcurfew (`npm uninstall`, `pnpm remove`, `yarn remove`, `bun rm` and their aliases), or runs them to rewrite configuration (`agentcurfew lock`, `agentcurfew init`, `depcurfew apply`, `depcurfew init`, also through `node …/cli.js` or a launcher) | `ask`; their commands that only read (`scan`, `verify`, `doctor`, `check` and the like) are left alone |
| `claude mcp add …` or `claude mcp add-json …` (with `--client-id`, `--callback-port`, several `KEY=value` after `--env`, `--option=value`) | `deny` when `mcp.allowServers` does not allow it or the server has a finding at high or above (plain HTTP, a secret), otherwise `ask` |
| a shell redirect, `tee`, `sed -i`, `cp` or `mv` to such a file, also spelled with a glob or braces the shell expands to its name (`CLAUD?.md`, `.claude/settings.jso{n,x}`), or with a name another command gives (a redirect to `$(…)`, `xargs`, `parallel`), or any other command that names one (`curl -o`, `dd of=`, `python -c`, `git checkout --`, an editor), unless it only reads files (`cat`, `grep`, `git diff`, `sed -n`, `find` without `-delete` or `-exec`, and the like) | `ask` |
| a shell command that names such a script or context file and does not only read it (`echo … >> .claude/hooks/fmt.sh`, `sed -i`, `cp`) | `ask` |
| a write to an agent file by a tool whose input agentcurfew does not know (such as `NotebookEdit`, which the matcher of `init --hook` includes), or an `Edit` of an agent file larger than 2 MB | `ask`, and `deny` for the oversized edit |
| a command that changes a folder that holds only agent configuration (`rm -rf .claude`, `rm -rf .CLAUDE`, `mv .c*e/ x`, `cp -r x/. .claude/`), or that moves into one and writes there (`cd .claude && echo x > settings.json`, also `cd -P`, `pushd`, `Set-Location`, `env -C`, `sudo -D`, and a path such as `~/.claude`) | `ask` |
| a call agentcurfew fails to check because of an error of its own, a shell command included | `ask` |
| anything else, or input it cannot read | nothing: the call goes through Claude Code's own permissions and other hooks |

The new text of a write is checked as an overlay on the project, so nothing is written to check it. The path is read the way the write lands, as the file system resolves it: every link on the way is read, also one whose target does not exist yet, and `..` counts after the link before it. A write to `docs/x.json` that links to `.claude/settings.json`, and a write to the file that `.claude/settings.json` links to, are both writes to the settings. On Windows and macOS, whose file systems ignore letter case, existing folders are spelled as on disk and new ones as the knowledge base spells them (`.CLAUDE/settings.json` is `.claude/settings.json`), and an NTFS `::$DATA` suffix is dropped. Commands are read with their wrappers taken off: `CI=1 …`, `env …`, `sudo …`, `nice …`, `timeout …`, `exec …`, `if …`, `(…)`, `$(…)`, `bash -c "…"`, `cmd /c …` and `pwsh -Command …` are checked as the command they run, and after a wrapper it does not know, from the first word that can begin an install. Each command is read as its shell reads it: `PowerShell` commands with PowerShell's quoting (the backtick escapes, a backslash is part of a path, so `Set-Content .claude\settings.json` names the settings), `cmd /c` with cmd's caret, and `Bash` and `Monitor` commands as bash does (`$'…'`, line continuations); paths with `\` count like paths with `/`. PowerShell cmdlets that only read (`Get-Content`, `Select-String`, `Get-ChildItem`, `Test-Path` and their aliases) are left alone. `init --hook` writes the matcher `Bash|PowerShell|Monitor|Write|Edit|NotebookEdit`; a hook installed by 1.2 or earlier has a shorter one, which you can widen by hand. Nothing is run or expanded to find this out; a file named through a variable (`f=CLAUDE.md; echo x > $f`) asks when the line uses the variable in a command that writes, but a script or an archive (`git apply`, `unzip`) is not seen; Claude Code's own permission prompt still applies to such commands. The hook's scans of the project have a budget of 15 s, half of the 30 s timeout `init --hook` writes, past which Claude Code would stop the hook and let the call through: a project too large to scan in time gets `ask`. To know which scripts and context files count, the hook reads the project's inventory: for every `Write` and `Edit` of a project file that is not an agent file, and for a shell command only when it has a word that can be a path and does not only read; nothing is run to find this out. Drift and `skills-lock.json` differences are left out, since any write changes the file. Secrets in the commands it quotes (a token in a skill source or a server name) are masked in its answers. The hook never answers `allow`, and it does not check installs of packages, which depcurfew's hook does.

**Installing it.** `agentcurfew init --hook` adds this entry to `hooks.PreToolUse` of `.claude/settings.json`, after any hook already there, such as depcurfew's, whose entry it keeps unchanged (the file is written back with two-space indentation); running it again adds nothing:

```json
{
  "matcher": "Bash|PowerShell|Monitor|Write|Edit|NotebookEdit",
  "hooks": [
    {
      "type": "command",
      "command": "node",
      "args": ["${CLAUDE_PROJECT_DIR}/node_modules/agentcurfew/dist/cli.js", "hook"],
      "timeout": 30
    }
  ]
}
```

Claude Code runs matching hooks in parallel and takes the strictest answer (`deny` over `defer` over `ask` over `allow`), so both hooks keep working. With `args`, node is started without a shell. Install agentcurfew as a dev dependency first: `agentcurfew doctor` warns (`agentcurfew-hook-missing`) when the hook points at a file that is not there, since the hook then checks nothing.
