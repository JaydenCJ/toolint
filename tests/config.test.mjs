// Config tests: the two setting shapes, strict validation of rule ids /
// severities / options, ignoreTools, and file loading with upward search.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ToolintConfigError,
  findConfigFile,
  loadConfigFile,
  resolveConfig,
} from "../dist/index.js";
import { tempDir } from "./helpers.mjs";

test("a bare severity string and the object form both resolve", () => {
  const config = resolveConfig({
    rules: {
      "enum-large": "off",
      "too-many-params": { severity: "error", options: { max: 6 } },
    },
  });
  assert.equal(config.rules.get("enum-large").severity, "off");
  assert.equal(config.rules.get("too-many-params").severity, "error");
  assert.equal(config.rules.get("too-many-params").options.max, 6);
});

test("an options-only entry keeps the rule's default severity", () => {
  const config = resolveConfig({ rules: { "too-many-params": { options: { max: 6 } } } });
  assert.equal(config.rules.get("too-many-params").severity, "warn");
});

test("unknown rule ids are a hard error, so typos cannot silently pass", () => {
  assert.throws(
    () => resolveConfig({ rules: { "enum-hueg": "off" } }),
    (error) => error instanceof ToolintConfigError && /unknown rule id "enum-hueg"/.test(error.message),
  );
});

test("unknown option names and non-numeric option values are rejected", () => {
  assert.throws(
    () => resolveConfig({ rules: { "too-many-params": { options: { maximum: 6 } } } }),
    /unknown option "maximum".*expected one of: max/,
  );
  assert.throws(
    () => resolveConfig({ rules: { "too-many-params": { options: { max: "six" } } } }),
    /must be a non-negative number/,
  );
});

test("invalid severities, unknown top-level keys, and non-array ignoreTools are rejected", () => {
  assert.throws(() => resolveConfig({ rules: { "name-verb": "fatal" } }), /invalid severity "fatal"/);
  assert.throws(() => resolveConfig({ rule: {} }), /unknown top-level key "rule"/);
  assert.deepEqual(resolveConfig({ ignoreTools: ["legacy_*"] }).ignoreTools, ["legacy_*"]);
  assert.throws(() => resolveConfig({ ignoreTools: "legacy_*" }), /array of name patterns/);
});

test("loadConfigFile reports unreadable files and invalid JSON with exit-2 errors", () => {
  const dir = tempDir();
  assert.throws(() => loadConfigFile(join(dir, "absent.json")), /cannot read config/);
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{ not json");
  assert.throws(() => loadConfigFile(bad), /invalid JSON/);
});

test("findConfigFile searches upward and stops at the filesystem root", () => {
  const root = tempDir();
  const nested = join(root, "packages", "server");
  mkdirSync(nested, { recursive: true });
  const configPath = join(root, "toolint.config.json");
  writeFileSync(configPath, JSON.stringify({ rules: { "enum-large": "off" } }));
  assert.equal(findConfigFile(nested), configPath);
  const loaded = loadConfigFile(findConfigFile(nested));
  assert.equal(loaded.rules.get("enum-large").severity, "off");
});
