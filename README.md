<img src="https://raw.githubusercontent.com/DevXord/agentcurfew/main/site/favicon.svg" alt="" width="96" height="96">

# agentcurfew

[![ci](https://github.com/DevXord/agentcurfew/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/DevXord/agentcurfew/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agentcurfew?color=6d28d9&label=npm)](https://www.npmjs.com/package/agentcurfew)
[![node](https://img.shields.io/badge/node-%E2%89%A520-6d28d9)](https://nodejs.org/)
[![license](https://img.shields.io/badge/license-MIT-6d28d9)](LICENSE)
[![docs](https://img.shields.io/badge/docs-agentcurfew.github.io-6d28d9)](https://agentcurfew.github.io/)

> One local, account-less security policy for the files that steer your AI coding agents: skills, MCP servers, hooks, context files and permissions.

A sibling of [depcurfew](https://depcurfew.github.io/): depcurfew guards the packages that people and agents install, agentcurfew guards the files that steer the agent. Documentation: [agentcurfew.github.io](https://agentcurfew.github.io/).

AI coding agents (Claude Code, Cursor, Codex CLI, Gemini CLI, Copilot in VS Code, Windsurf, Cline) read files from your repository and your machine that decide how they behave: `SKILL.md` files with bundled scripts, MCP server configs, hooks, context files such as `AGENTS.md` and `CLAUDE.md`, and permission settings. Whoever can change those files can steer the agent, so they are a supply chain of their own.

agentcurfew:

- **lists** every such component in a project, for every agent it knows, including settings that run a command (`statusLine`, `apiKeyHelper`) and the scripts of the project that hooks run (`scan --inventory`);
- **checks** them against [15 rules](docs/rules.md): hidden Unicode, unpinned `npx` MCP servers, plain-HTTP MCP endpoints, secrets in configs, dangerous hooks, auto-run on open, permission bypasses, instructions fetched at run time, persistence instructions and more (`scan`);
- **locks** them with checksums in `agentcurfew.lock`, the scripts hooks run included, so CI fails when one changes (`lock`, `verify`);
- **enforces** a policy in `agentcurfew.policy.json`: allowed skill sources and MCP servers, pinned versions, exceptions with a reason and an end date (`init`, [policy](docs/policy.md));
- **finds** configuration that agents ignore or that does not work: misnamed files, wrong keys, settings that another file overrides ([doctor](docs/doctor.md));
- **guards** the agent itself: an MCP server with read-only checks, and a Claude Code hook that stops dangerous writes to these files ([MCP server and hook](docs/mcp.md)).

Every fact about an agent (paths, formats, precedence) comes from its official docs or source code, with the address and the date, in the [knowledge base](docs/knowledge.md).

## Rules of the scanner

1. It **never runs** what it reads: no MCP server is started, no hook, script or command is run.
2. It makes **no network calls**. Checks that need a registry stay with [depcurfew](#with-depcurfew).
3. It treats every file as hostile: size and depth limits, no links followed out of the project, secrets masked in every output.
4. One deterministic lockfile for every agent and every kind of component.

## Install

```bash
npm install --save-dev agentcurfew
# or, without installing
npx agentcurfew@1 scan
```

It needs Node.js 20 or later. The command is `agentcurfew`.

## Use

```bash
agentcurfew scan                        # exit code 1 on a finding at level high or above, or a file it could not read
agentcurfew scan --fail-on medium --json
agentcurfew scan --sarif > agentcurfew.sarif   # for GitHub Code Scanning
agentcurfew lock                        # write agentcurfew.lock; commit it
agentcurfew verify                      # in CI: exit code 1 when anything changed since the lock
agentcurfew init                        # write agentcurfew.policy.json from what the project has now
agentcurfew doctor                      # find files and settings that agents ignore
agentcurfew explain hidden-unicode      # what a rule finds and how to fix it
```

Run `agentcurfew` for the common commands, and `agentcurfew help <command>` for the options and examples of one. `--user` also reads your home directory and machine settings. JSON and SARIF output are described in [docs/cli-json.md](docs/cli-json.md).

A clean scan means that none of the rules' patterns was found, not that the configuration is safe: see [what agentcurfew does not find](docs/rules.md#what-agentcurfew-does-not-find).

## MCP server and hook

`agentcurfew mcp` serves read-only tools to an agent over MCP (stdio): `check_skill` and `check_mcp_config` before something is installed, `scan_project` and `explain_rule`. It reads only its own folder, folders given with `--root` and the roots the client shares.

`agentcurfew init --hook` adds a `PreToolUse` hook to `.claude/settings.json`, next to depcurfew's hook if there is one. Writes to the files that steer agents ask first, and are denied when the new text has a finding at high or above or breaks the policy; `npx skills add` and `claude mcp add` are denied outside the policy. The hook never allows anything by itself. See [docs/mcp.md](docs/mcp.md).

## With depcurfew

agentcurfew protects what configures the agent; [depcurfew](https://github.com/DevXord/depcurfew) protects the packages the project and the agent install. Together:

- When depcurfew 1.5.2 or a later 1.x is installed and the project has `depcurfew.json`, the rule `mcp-package` checks the package each MCP server starts through `npx`, `uvx` and the like with depcurfew's library, **offline**: sources the policy forbids and specs that are not specs. Checks that need the registry (release age, existence, install scripts, similar names, known malicious versions) stay with `npx depcurfew check <package>`, which `unpinned-mcp-server` points to.
- `agentcurfew doctor` warns when the project has `depcurfew.json` but Claude Code has no depcurfew hook (`depcurfew-hook-missing`), and when that hook points at a depcurfew that is not installed (`depcurfew-hook-broken`, an error with `onFailure: "block"`, since every command is then blocked).
- `agentcurfew init --hook` adds its own hook next to depcurfew's, and never changes it.

depcurfew is an optional peer dependency: without it, everything else works the same.

## GitHub Action

```yaml
permissions:
  contents: read
steps:
  - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
    with:
      persist-credentials: false
  - uses: DevXord/agentcurfew@<full commit sha> # pin to a commit, not a tag
    with:
      command: scan          # or verify, or doctor (whose fail-on levels are error, warning, info)
      fail-on: high
```

Inputs: `command`, `directory`, `fail-on`, `sarif-file`, `upload-sarif` (needs `security-events: write`) and `build-from-source` (for tests of the action itself). Output: `exit-code`. A released commit runs the matching version of agentcurfew from npm. How releases are made: [docs/RELEASING.md](docs/RELEASING.md).

## Development

```bash
npm ci --ignore-scripts
npm test
npm run typecheck
npm run check:pkg
npm run site        # the documentation site, into dist-site/
```

The plan lives in [docs/PLAN.md](docs/PLAN.md); decisions and open questions in [docs/decisions.md](docs/decisions.md); the development log in [docs/CHANGELOG-dev.md](docs/CHANGELOG-dev.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).
