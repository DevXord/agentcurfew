# Development changelog

A running log of what each session on agentcurfew did. Not the user-facing changelog, which starts with the first publish.

## 2026-11-06: Phase 0, skeleton

- Moved the brief to [docs/PLAN.md](PLAN.md); added [CLAUDE.md](../CLAUDE.md) (section 7 of the plan, translated to English), [docs/decisions.md](decisions.md) and this changelog.
- `package.json`: ESM-only, binaries `agentcurfew` and `acf`, no runtime dependencies, exact dev pins (D-005).
- CLI scaffold: `src/cli.ts` (entry wrapper for closed pipes and the `NO_COLOR` warning, adapted from depcurfew), `src/cli/run.ts` (`util.parseArgs`, help, version, errors in the what/where/fix form), `src/cli/io.ts`, `src/version.ts`. Help lists the commands of the plan as planned, because none exists yet.
- Tests: `tests/cli.test.ts`, `tests/setup.test.ts` and two guards that make the network and every `child_process` API throw. `npm run fuzz` runs `tests/fuzz/cli-args.fuzz.ts` (fast-check, 2000 runs).
- Repository policy: `depcurfew.json`, plus `.npmrc` from `depcurfew apply` (D-006).
- `LICENSE`, `SECURITY.md`, `README.md`, `.gitignore`.

Not done in this phase: `src/knowledge/` is empty (phase 1). Only Node 25.8.1 was used, so the `engines` floor is unproven (Q-004).
