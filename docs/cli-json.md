# JSON and SARIF output

Every command that takes `--json` prints one JSON document on stdout and nothing on stderr. Each document starts with `schemaVersion`, which grows only when a change would break a reader: a field removed, renamed or given another meaning. New fields can appear without a new version, so readers should ignore fields they do not know. The JSON Schemas are in the package under `schemas/` and at `https://unpkg.com/agentcurfew/schemas/<name>.json`; the tests check the real output of each command against them.

No output ever holds the content of a scanned file or a secret in full. Text that comes from scanned files (names, messages) has control and invisible characters written as `\u` escapes.

| Command | Schema | Version |
| --- | --- | --- |
| `scan --json` | [schemas/scan.json](../schemas/scan.json) | 3 |
| `scan --inventory --json` | [schemas/inventory.json](../schemas/inventory.json) | 1 |
| `verify --json` | [schemas/verify.json](../schemas/verify.json) | 1 |
| `doctor --json` | [schemas/doctor.json](../schemas/doctor.json) | 1 |
| `scan --sarif` | [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json) | 2.1.0 |

## scan --json (version 3)

- `failOn`: the threshold in effect, from `--fail-on`, the policy or the default `high`.
- `components`: what was scanned: `kind`, `agents`, `scope` (`project`, `user`, `managed`), `file` (relative to the project, or starting with `~/`), `name`, `bytes`, and for skills `files` (`path`, `bytes`).
- `findings`: `rule`, `level` (`critical`, `high`, `medium`, `low`, `info`), `kind`, `file`, `name`, `message`, and when known `line` and `column` (1-based, columns in code points), `tag` (a kind of hit within a rule, such as `network`) and `policy` (the setting of `agentcurfew.policy.json` that set the level).
- `suppressed`: findings accepted by an exception of the policy: `finding`, `reason`, `until`.
- `problems`: places the scanner could not fully read: `code` and `file`.

Version 2 had no `suppressed`, `tag` or `policy`; version 1 is the inventory.

## scan --inventory --json (version 1)

`components` and `problems` as above, without rules.

## verify --json (version 1)

- `ok`: true when the project matches `agentcurfew.lock`.
- `changes`: `type` (`added`, `removed`, `changed`), `kind`, `file`, `name`, `details` (what changed, with secrets redacted).
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
- `partialFingerprints["agentcurfew/v1"]` is a hash of rule, kind, file, component and message, so a finding keeps its identity when lines move.
- Findings accepted by the policy are included with a `suppressions` entry (`kind` `external`, the exception's reason as `justification`).
- No time stamps and no absolute paths, so the same project gives the same file.
