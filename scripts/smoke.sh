#!/usr/bin/env bash
# Smoke test for toolint: exercises the real CLI end to end — clean and
# messy example lints, every output format, stdin, config overrides and
# discovery, ignore patterns, --quiet, --max-warnings, and the full exit
# code contract. No network, idempotent, runs from a clean checkout
# (after `npm install`). Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

CLI="node $ROOT/dist/cli.js"
export NO_COLOR=1

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents the flags; --rules
#    lists all 34 rules.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for flag in --stdin --format --config --quiet --max-warnings --rules; do
  echo "$HELP" | grep -q -- "$flag" || fail "--help missing $flag"
done
$CLI --rules | grep -q "34 rules" || fail "--rules count wrong"
echo "[smoke] --version/--help/--rules ok ($CLI_VERSION, 34 rules)"

# 3. The clean example passes with exit 0.
CLEAN_OUT="$($CLI examples/clean-server.tools.json)" || fail "clean example did not exit 0"
echo "$CLEAN_OUT" | grep -q "5 tools clean" || fail "clean summary wrong"
echo "[smoke] clean example ok (exit 0)"

# 4. The messy example fails with exit 1 and reports the headline rules.
set +e
MESSY_OUT="$($CLI examples/messy-server.tools.json)"
MESSY_CODE=$?
set -e
[ "$MESSY_CODE" -eq 1 ] || fail "messy example exit code $MESSY_CODE, expected 1"
for rule in name-generic name-collision enum-vague default-mismatch required-undeclared boolean-negated; do
  echo "$MESSY_OUT" | grep -q "$rule" || fail "messy report missing $rule"
done
echo "$MESSY_OUT" | grep -qE "✖ [0-9]+ problems" || fail "messy summary line missing"
echo "[smoke] messy example ok (exit 1, headline rules reported)"

# 5. JSON output parses and carries the same verdict; runs are deterministic.
$CLI --format json examples/messy-server.tools.json > "$WORKDIR/report1.json" || true
$CLI --format json examples/messy-server.tools.json > "$WORKDIR/report2.json" || true
cmp -s "$WORKDIR/report1.json" "$WORKDIR/report2.json" || fail "json output not deterministic"
node -e "
  const report = require('$WORKDIR/report1.json');
  if (report.toolint !== '$PKG_VERSION') process.exit(1);
  if (report.summary.errors < 5) process.exit(1);
  if (!report.files[0].findings.every((f) => f.rule && f.path && f.message)) process.exit(1);
" || fail "json report malformed"
echo "[smoke] --format json ok (deterministic, well-formed)"

# 6. stdin accepts a raw tools/list JSON-RPC response.
set +e
STDIN_OUT="$(echo '{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"run"}]}}' | $CLI --stdin --format compact)"
STDIN_CODE=$?
set -e
[ "$STDIN_CODE" -eq 1 ] || fail "stdin lint exit code $STDIN_CODE, expected 1"
echo "$STDIN_OUT" | grep -q "name-generic" || fail "stdin lint missed name-generic"
echo "[smoke] --stdin ok"

# 7. Config overrides apply: the bundled example config demotes name-verb
#    to info, and ignore patterns plus discovery work from a nested cwd.
set +e
CFG_OUT="$($CLI --config examples/toolint.config.json --format compact examples/messy-server.tools.json)"
set -e
echo "$CFG_OUT" | grep -q "info \[name-verb\]" || fail "example config did not demote name-verb"
mkdir -p "$WORKDIR/project/deep"
echo '{"ignoreTools":["*"]}' > "$WORKDIR/project/toolint.config.json"
cp examples/messy-server.tools.json "$WORKDIR/project/deep/tools.json"
(cd "$WORKDIR/project/deep" && $CLI tools.json | grep -q "0 tools clean") || fail "config discovery/ignore failed"
echo "[smoke] config overrides + discovery ok"

# 8. --quiet keeps errors only; --max-warnings flips warnings to exit 1.
set +e
QUIET_OUT="$($CLI --quiet --format compact examples/messy-server.tools.json)"
set -e
if echo "$QUIET_OUT" | grep -q " warn \["; then fail "--quiet leaked warnings"; fi
echo "$QUIET_OUT" | grep -q " error \[" || fail "--quiet dropped errors"
cat > "$WORKDIR/warnish.json" <<'JSON'
[{"name":"weather_lookup","description":"Look up the current weather for a city by name.",
  "inputSchema":{"type":"object","properties":{"city":{"type":"string","description":"City name to look up."}}}}]
JSON
$CLI "$WORKDIR/warnish.json" >/dev/null || fail "warning-only file should exit 0"
set +e
$CLI "$WORKDIR/warnish.json" --max-warnings 0 >/dev/null 2>&1
CAPPED=$?
set -e
[ "$CAPPED" -eq 1 ] || fail "--max-warnings 0 should exit 1"
echo "[smoke] --quiet/--max-warnings ok"

# 9. Bad input is a usage error (exit 2), on stderr.
set +e
$CLI "$WORKDIR/absent.json" >/dev/null 2>"$WORKDIR/err.txt"
MISSING=$?
echo "not json" > "$WORKDIR/bad.json"
$CLI "$WORKDIR/bad.json" >/dev/null 2>>"$WORKDIR/err.txt"
INVALID=$?
set -e
[ "$MISSING" -eq 2 ] || fail "missing file exit code $MISSING, expected 2"
[ "$INVALID" -eq 2 ] || fail "invalid JSON exit code $INVALID, expected 2"
grep -q "cannot read" "$WORKDIR/err.txt" || fail "missing-file error not on stderr"
echo "[smoke] exit-2 error paths ok"

echo "SMOKE OK"
