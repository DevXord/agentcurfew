#!/usr/bin/env bash
# Runs the built CLI (dist/) on the fixtures and checks exit codes and output, without the test framework, so that it
# can run on every Node version in engines. Usage: scripts/smoke.sh [path to dist/cli.js]
set -euo pipefail

CLI="${1:-dist/cli.js}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
failures=0

expect() {
  local want="$1"
  shift
  local got=0
  node "$CLI" "$@" > "$WORK/out" 2> "$WORK/err" || got=$?
  if [ "$got" != "$want" ]; then
    echo "FAIL: agentcurfew $* exited with $got, expected $want"
    sed 's/^/  | /' "$WORK/out" "$WORK/err" | head -20
    failures=$((failures + 1))
  else
    echo "ok:   agentcurfew $* -> $got"
  fi
}

contains() {
  if ! grep -q -- "$1" "$WORK/out"; then
    echo "FAIL: output does not contain: $1"
    failures=$((failures + 1))
  fi
}

echo "node $(node --version)"
F="$ROOT/tests/fixtures"

expect 0 --version
expect 0
contains "Common commands:"
expect 0 help scan
expect 2 scna
expect 0 scan "$F/repos/empty"
expect 1 scan "$F/rules/plain-http-mcp/positive"
contains "plain-http-mcp"
expect 0 scan "$F/rules/plain-http-mcp/negative"
expect 1 scan "$F/rules/plain-http-mcp/positive" --json
node -e 'const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); if (o.schemaVersion !== 3) process.exit(1)' "$WORK/out" || { echo "FAIL: scan --json"; failures=$((failures + 1)); }
expect 1 scan "$F/rules/plain-http-mcp/positive" --sarif
node -e 'const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); if (o.version !== "2.1.0") process.exit(1)' "$WORK/out" || { echo "FAIL: scan --sarif"; failures=$((failures + 1)); }
expect 0 scan "$F/repos/codex-toml" --inventory
contains "mcp-server"
expect 0 scan "$F/repos/claude-basic" --inventory
contains "skill"

cp -R "$F/repos/claude-basic" "$WORK/project"
expect 0 lock "$WORK/project"
expect 0 verify "$WORK/project"
echo "changed" > "$WORK/project/CLAUDE.md"
expect 1 verify "$WORK/project"
contains "changed: context-file CLAUDE.md"

expect 0 doctor "$F/repos/claude-basic"
expect 1 doctor "$F/doctor/deprecated-format/positive"
expect 0 init "$F/repos/claude-basic" --print
contains '"version": 1'
expect 0 explain hidden-unicode

if [ "$failures" -gt 0 ]; then
  echo "$failures smoke check(s) failed"
  exit 1
fi
echo "all smoke checks passed"
