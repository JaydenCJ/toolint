// End-to-end CLI tests against the built dist/cli.js in child processes:
// real argv, real files, real stdin, real exit codes.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXAMPLES, ROOT, runCli, tempDir } from "./helpers.mjs";

const CLEAN = join(EXAMPLES, "clean-server.tools.json");
const MESSY = join(EXAMPLES, "messy-server.tools.json");

test("--version prints the package.json version; --help documents flags; bare invocation is exit 2", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const result = runCli(["--version"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), pkg.version);

  const help = runCli(["--help"]);
  assert.equal(help.status, 0);
  for (const flag of ["--stdin", "--format", "--config", "--quiet", "--max-warnings", "--rules"]) {
    assert.ok(help.stdout.includes(flag), flag);
  }
  const bare = runCli([]);
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /no input/);
});

test("--rules lists all 34 rules grouped by category", () => {
  const result = runCli(["--rules"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /34 rules/);
  for (const category of ["naming:", "description:", "schema:", "enum:"]) {
    assert.ok(result.stdout.includes(category), category);
  }
  assert.match(result.stdout, /^  enum-vague\s+warn/m);
});

test("a clean file exits 0 with a clean summary", () => {
  const result = runCli([CLEAN]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /✔ 5 tools clean/);
});

test("a messy file exits 1 and reports the headline problems", () => {
  const result = runCli([MESSY]);
  assert.equal(result.status, 1);
  for (const rule of ["name-generic", "name-collision", "enum-vague", "default-mismatch", "boolean-negated"]) {
    assert.ok(result.stdout.includes(rule), rule);
  }
  assert.match(result.stdout, /✖ \d+ problems/);
});

test("--format json and --format compact emit machine-readable output on the same exit contract", () => {
  const asJson = runCli(["--format", "json", MESSY]);
  assert.equal(asJson.status, 1);
  const document = JSON.parse(asJson.stdout);
  assert.equal(document.files[0].file, MESSY);
  assert.ok(document.summary.errors > 0);

  const asCompact = runCli(["--format", "compact", MESSY]);
  const findingLines = asCompact.stdout.trim().split("\n").filter((line) => line.includes("] "));
  assert.ok(findingLines.length >= 20);
  assert.match(findingLines[0], /: (error|warn|info) \[/);
});

test("--stdin lints a tools/list response piped in", () => {
  const input = JSON.stringify({ tools: [{ name: "run" }] });
  const result = runCli(["--stdin"], { input });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /<stdin>/);
  assert.match(result.stdout, /name-generic/);
});

test("multiple files are linted in one run with a combined summary", () => {
  const result = runCli([CLEAN, MESSY]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /in 4 of 9 tools/);
});

test("unreadable files and invalid JSON exit 2 with a message on stderr", () => {
  const missing = runCli([join(tempDir(), "absent.json")]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /cannot read/);

  const bad = join(tempDir(), "bad.json");
  writeFileSync(bad, "{ nope");
  const invalid = runCli([bad]);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /invalid JSON/);

  // Unknown flags and bad flag values follow the same exit-2 contract.
  assert.equal(runCli(["--frobnicate"]).status, 2);
  assert.equal(runCli(["--format", "xml", MESSY]).status, 2);
  assert.equal(runCli(["--max-warnings", "lots", MESSY]).status, 2);
});

test("--config applies rule overrides; a broken config exits 2", () => {
  const dir = tempDir();
  const config = join(dir, "toolint.config.json");
  writeFileSync(config, JSON.stringify({ rules: { "name-generic": "off", "tool-description-placeholder": "off" } }));
  const result = runCli(["--config", config, "--format", "compact", MESSY]);
  assert.ok(!result.stdout.includes("name-generic"));

  writeFileSync(config, JSON.stringify({ rules: { "no-such-rule": "off" } }));
  const broken = runCli(["--config", config, MESSY]);
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /unknown rule id/);

  // The bundled example config demotes name-verb to info, as documented.
  const bundled = runCli(["--config", join(EXAMPLES, "toolint.config.json"), "--format", "compact", MESSY]);
  assert.equal(bundled.status, 1); // errors remain
  assert.match(bundled.stdout, /info \[name-verb\]/);
});

test("config discovery finds toolint.config.json above the cwd; --no-config skips it", () => {
  const dir = tempDir();
  writeFileSync(join(dir, "toolint.config.json"), JSON.stringify({ ignoreTools: ["*"] }));
  writeFileSync(join(dir, "tools.json"), JSON.stringify([{ name: "run" }]));

  const discovered = runCli(["tools.json"], { cwd: dir });
  assert.equal(discovered.status, 0); // every tool ignored -> clean
  assert.match(discovered.stdout, /0 tools clean/);

  const skipped = runCli(["tools.json", "--no-config"], { cwd: dir });
  assert.equal(skipped.status, 1);
});

test("--quiet drops warn/info findings but keeps errors and the exit code", () => {
  const result = runCli(["--quiet", "--format", "compact", MESSY]);
  assert.equal(result.status, 1);
  assert.ok(!result.stdout.includes(" warn ["));
  assert.ok(result.stdout.includes(" error ["));
});

test("--max-warnings turns an otherwise-passing run into exit 1", () => {
  const dir = tempDir();
  const file = join(dir, "warnish.json");
  // One warning (name-verb), zero errors.
  writeFileSync(file, JSON.stringify([{
    name: "weather_lookup",
    description: "Look up the current weather for a city by name.",
    inputSchema: { type: "object", properties: { city: { type: "string", description: "City name to look up." } } },
  }]));
  assert.equal(runCli([file]).status, 0);
  const capped = runCli([file, "--max-warnings", "0"]);
  assert.equal(capped.status, 1);
  assert.match(capped.stderr, /exceed --max-warnings 0/);
});

test("the bundled example config tames the messy example as documented", () => {
  const result = runCli(["--config", join(EXAMPLES, "toolint.config.json"), "--format", "compact", MESSY]);
  assert.equal(result.status, 1); // errors remain
  assert.match(result.stdout, /info \[name-verb\]/); // demoted from warn
});
