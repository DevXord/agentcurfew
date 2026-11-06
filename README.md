# agentcurfew

> One local, account-less security policy for the files that steer your AI coding agents — skills, MCP servers, hooks, context files, permissions.

**Status:** pre-release, nothing published yet; the first release will be 1.0.0. Phases 0 to 6 and the release machinery of phase 9 are done: `acf scan` checks what steers agents in a project against the [rules](docs/rules.md), from a sourced [knowledge base](docs/knowledge.md), `acf scan --inventory` lists it, `acf lock` and `acf verify` pin it with checksums in `agentcurfew.lock`, `agentcurfew.policy.json` sets what is allowed ([policy](docs/policy.md)), and `acf doctor` finds configuration that agents ignore ([checks](docs/doctor.md)).

```bash
acf scan                       # exit code 1 on a finding at level high or above
acf scan --fail-on medium --json
acf lock                       # write agentcurfew.lock; commit it
acf verify                     # in CI: exit code 1 when anything changed since the lock
acf init                       # write agentcurfew.policy.json from what the project has now
acf doctor                     # find files and settings that agents ignore
acf explain hidden-unicode
acf scan --sarif > agentcurfew.sarif   # for GitHub Code Scanning
```

Run `acf` for the common commands, and `acf help <command>` for the options and examples of one. JSON and SARIF output are described in [docs/cli-json.md](docs/cli-json.md).

A clean scan means that none of the rules' patterns was found, not that the configuration is safe: see [what agentcurfew does not find](docs/rules.md#what-agentcurfew-does-not-find).

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
      command: scan          # or verify, doctor
      fail-on: high
```

Inputs: `command`, `directory`, `fail-on`, `sarif-file` and `upload-sarif` (needs `security-events: write`). Output: `exit-code`. A released commit runs the matching version of agentcurfew from npm; until the first release (1.0.0) the action builds agentcurfew from its own source. How releases are made: [docs/RELEASING.md](docs/RELEASING.md).

## What it does (when finished)

AI coding agents (Claude Code, Cursor, Codex, Gemini CLI, Copilot, Windsurf, Cline) read files from your repository and your machine that control how they behave: `SKILL.md` with bundled scripts, MCP server configs, hooks, context files (`AGENTS.md`, `CLAUDE.md`, …), permission settings. That is a new supply chain, and attacks on it are already in the wild (ToxicSkills, ClawHub, the tensorlake worm, CVE‑2025‑59536, CVE‑2026‑21852).

`agentcurfew` inventories every such component in a project, locks it with checksums in `agentcurfew.lock`, enforces an `agentcurfew.policy.json` and flags dangerous patterns (hidden Unicode, unpinned `npx` MCP servers, plain‑HTTP MCP endpoints, secrets in configs, persistence rules that rewrite context files, …).

It is a **sibling to [depcurfew](https://github.com/DevXord/depcurfew)**, not a replacement: depcurfew protects the packages your project installs (including those an agent installs for you), agentcurfew protects the files that configure the agent itself.

## Rules of the scanner

1. The scanner **never executes** what it scans. No MCP server is started to read its description, no script or hook runs, no command is spawned.
2. It makes **no network calls**. Whatever has to be looked up about packages (ages, similar names, known‑malicious versions) is delegated to depcurfew's local OSV data as an optional peer.
3. One lockfile for every agent and every component type.

## Install (planned)

```bash
npm i -g agentcurfew
# or, one-shot
npx agentcurfew scan
```

## Development

```bash
npm install
npm test
npm run check:pkg
```

The full plan lives in [docs/PLAN.md](docs/PLAN.md); decisions and open questions in [docs/decisions.md](docs/decisions.md).

## License

[MIT](LICENSE).
