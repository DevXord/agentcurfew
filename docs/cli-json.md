# JSON and SARIF output

Every command that takes `--json` prints one JSON document on stdout and nothing on stderr when it runs. When it cannot run (a directory that does not exist, a policy that breaks its schema, a lock that cannot be read), it prints the usual error on stderr and nothing on stdout, with exit code 2 for wrong input and 1 otherwise, so a reader should check the exit code before parsing. Each document starts with `schemaVersion`, which grows only when a change would break a reader: a field removed, renamed or given another meaning. New fields can appear without a new version, so readers should ignore fields they do not know. The JSON Schemas are in the package under `schemas/` and at `https://unpkg.com/agentcurfew/schemas/<name>.json`; the tests check the real output of each command against them.

No output ever holds the content of a scanned file or a secret in full. Text that comes from scanned files (names, messages) has control and invisible characters written as `\u` escapes.

| Command | Schema | Version |
| --- | --- | --- |
| `scan --json` | [schemas/scan.json](../schemas/scan.json) | 3 |
| `scan --inventory --json` | [schemas/inventory.json](../schemas/inventory.json) | 1 |
| `verify --json` | [schemas/verify.json](../schemas/verify.json) | 1 |
| `doctor --json` | [schemas/doctor.json](../schemas/doctor.json) | 1 |
| `scan --sarif` | [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json) | 2.1.0 |

Every document also has `producer`: `name` (`agentcurfew`), `version` and `knowledge`, the date of the newest fact in the knowledge base. It holds no time, so two runs on the same project give the same document.

**Component ids.** Each component has `id`, stable within its kind and file. For most kinds it is the name: the key of an MCP server, the dotted path of a permission or setting, the name of a file or skill folder. A hook's `name` is its position (`PreToolUse#0`), which shifts when a hook is added before it, so its `id` is its event, its matcher (`*` when it has none) and the first 10 hex digits of a sha256 over the handler with its secrets redacted, as in `PreToolUse:Bash:3f2a9c1e07`; an editor task without a label has `task:` and the same kind of hash. Two identical handlers of one event get `~2`, `~3` in order. A matcher or event longer than 64 characters, or with spaces or invisible characters, is written as `m-` or `e-` and 8 hex digits of its hash. An id never confirms a secret: a change of a secret's value alone keeps it.

## scan --json (version 3)

- `failOn`: the threshold in effect, from `--fail-on`, the policy or the default `high`.
- `components`: what was scanned: `kind` (`skill`, `mcp-server`, `hook`, `auto-run`, `context-file`, `permission`, `subagent`, `command`, `command-setting`, `setting`), `id`, `agents`, `scope` (`project`, `user`, `managed`), `file` (relative to the project, or starting with `~/`), `name`, `bytes`, `hash` (the checksum `agentcurfew.lock` holds for it), and `files` (`path`, `bytes`): for a skill its files, relative to its folder; for a hook, a task or a command setting the scripts of the project it runs, with `filesRoot` `project` because those paths are relative to the project.
- `findings`: `rule`, `level` (`critical`, `high`, `medium`, `low`, `info`), `kind`, `file`, `name`, `componentId` (the `id` of the component, absent for a finding about the whole project with no component), `message`, and when known `line` and `column` (1-based, columns in code points), `tag` (a kind of hit within a rule, such as `network`) and `policy` (the setting of `agentcurfew.policy.json` that set the level).
- `suppressed`: findings accepted by an exception of the policy: `finding`, `reason`, `until`.
- `problems`: places the scanner could not fully read: `code` (`outside-project`, `too-large`, `too-deep`, `too-many-entries`, `unreadable`, `unparsable`, `not-followed`) and `file`. `too-large`, `too-deep`, `too-many-entries` and `unreadable` fail `scan` and `verify`.
- `depcurfew`: present when `mcp-package` did not check the packages of MCP servers: `status` (`missing`, `unsupported`, `no-policy`, `invalid-policy`), `reason` and `servers`, the number of servers it would have checked.

Version 2 had no `suppressed`, `tag` or `policy`; version 1 is the inventory.

## scan --inventory --json (version 1)

`components` and `problems` as above, without rules.

## verify --json (version 1)

- `ok`: true when the project matches `agentcurfew.lock`.
- `changes`: `type` (`added`, `removed`, `changed`), `kind`, `file`, `name`, `id`, `details` (what changed, with secrets redacted). Components are matched by `id` when the lock has ids, so a hook added before others is one `added` change; an edited hook, whose `id` changes, is matched by its place and reported as `changed`.
- `lockDigest`: the sha256 of the `agentcurfew.lock` that `agentcurfew lock` would write now, to compare states without the lock itself.
- `lockWithoutIds`: `true` when the lock was written by agentcurfew 1.0, before ids; it is then compared by name, and the text output asks for one `agentcurfew lock`.
- `unknownKinds`: the number of components of kinds this version does not know, present only when there are any: a newer agentcurfew wrote the lock, and those components were skipped, not compared. The rest is compared as usual.
- `skillsLock`: findings of the comparison with `skills-lock.json`, which never change `ok`.
- `problems`: as in scan.

## doctor --json (version 1)

- `failOn`, `ok`.
- `checks`: `id`, `title`, `status` (`passed`, `failed`, `not applicable`), `fix`, and `hits` with `file`, `message`, `level` (`error`, `warning`, `info`) and `sources` (https addresses of the facts behind the finding).

## scan --sarif

SARIF 2.1.0 for GitHub Code Scanning and other tools:

- `tool.driver.rules` lists every rule with its description, fix, a link to `docs/rules.md`, tags `security` and `external/owasp-ast/astNN`, and `security-severity` (critical 9.5, high 7.5, medium 5.0, low 3.0, info 1.0).
- `level`: critical and high are `error`, medium `warning`, low and info `note`; the agentcurfew level is kept in `properties.level`.
- Locations are relative to the project with `uriBaseId` `%SRCROOT%`; columns are code points (`columnKind` `unicodeCodePoints`).
- `partialFingerprints["agentcurfew/v1"]` is a hash of rule, kind, file, component name and message, so a finding keeps its identity when lines move; it is the same as in 1.0, so existing alerts in GitHub Code Scanning are kept. `partialFingerprints["agentcurfew/v2"]` uses the component's `id` instead of its name, so a finding of a hook also keeps its identity when a hook is added before it. `properties.componentId` holds the `id`.
- Findings accepted by the policy are included with a `suppressions` entry (`kind` `external`, the exception's reason as `justification`).
- No time stamps and no absolute paths, so the same project gives the same file.
