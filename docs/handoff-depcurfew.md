# For the depcurfew session

Written on 2026-11-07 by the agentcurfew session, to be passed to a session that works on [depcurfew](https://github.com/DevXord/depcurfew). agentcurfew does not change depcurfew; these are requests and observations, each with what was seen and a possible fix. The same points are Q-012 in [decisions.md](decisions.md).

agentcurfew uses depcurfew 1.5.2 as an optional peer: its rule `mcp-package` calls `checkSpecs` offline (a `fetch` that refuses every request, the project's `depcurfew.json`, `new PopularNames([])`), for the packages that MCP servers start through `npx`, `uvx` and the like.

## 1. Export the lists of popular package names

- **Seen:** `popularPackages` and `popularPythonPackages` are not exported from depcurfew's public API, so `PopularNames` can only be built from an empty list. agentcurfew therefore cannot report MCP server packages whose names imitate a popular package, offline, without copying the lists, which it must not do.
- **Possible fix:** export the two lists, or a `defaultPopularNames()` that returns the `PopularNames` the CLI uses.

## 2. Export the default folder of the local OSV.dev data

- **Seen:** `LocalOsvData(directory)` is exported, but the folder that `depcurfew osv update` writes to is not, so agentcurfew cannot point it at the data a user already downloaded without copying the logic that finds that folder.
- **Possible fix:** export a function that returns the default data folder, or a `defaultOsvData()` that returns the `LocalOsvData` the CLI uses (and undefined when nothing was downloaded).

## 3. `min-release-age-exclude` and `npm exec`

- **Seen:** with npm 11.21.1, `min-release-age-exclude[]=depcurfew` in `.npmrc` is honoured by `npm install` but not by `npm exec` or `npx` (agentcurfew D-022, 2026-11-06). A fresh depcurfew release could therefore be blocked when run through `npx depcurfew`.
- **Possible fix:** note it in depcurfew's docs where `apply` writes the exclusion, or have `apply` say that `npx` ignores it.

## 4. The hook judges `npx <bin>` of a local dev dependency by the registry

- **Seen:** depcurfew's Claude Code hook, active in agentcurfew's sessions, denied `npx vitest` because the newest vitest on the registry (5.1.0) was 4 days old, although the project pins an older vitest that `npx` runs from `node_modules/.bin`. `npx tsdown` was denied the same way and `npx tsc` got a warning. The workaround in agentcurfew is `npm test`, `npm run build` and `npm run typecheck`.
- **Possible fix:** when `npx <bin>` names a binary that `node_modules/.bin` already has, check the installed version from the project's lockfile instead of the registry's newest one; or do not judge `npx` without a version when the package is a locked dependency.

## 5. A link to the sibling

- **Seen:** agentcurfew now presents itself as depcurfew's sibling (D-036 of agentcurfew): its README, site footer, navigation and social preview link to https://depcurfew.github.io/, and its site at https://agentcurfew.github.io/ uses depcurfew's layout in violet. depcurfew does not mention agentcurfew yet.
- **Possible fix:** add agentcurfew to depcurfew's "Other tools" page and a one-line sibling note near the top of its README, for example "A sibling of agentcurfew (https://agentcurfew.github.io/): depcurfew guards the packages that people and agents install, agentcurfew guards the files that steer the agent." Only if the maintainer wants it.
