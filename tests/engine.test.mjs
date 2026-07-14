// Engine tests: severity overrides, disabling rules, option merging,
// ignoreTools patterns, deterministic ordering, and summary accounting.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { lintTools, resolveConfig, defaultConfig, displayName } from "../dist/index.js";
import { cleanTool } from "./helpers.mjs";

test("a fully clean toolset produces zero findings", () => {
  const result = lintTools([cleanTool()]);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.summary, { errors: 0, warnings: 0, infos: 0, tools: 1, flaggedTools: 0 });
});

test("config can raise, lower, and disable a rule's severity", () => {
  const tools = [cleanTool({ name: "user_report" })]; // name-verb fires at warn by default
  const asDefault = lintTools(tools).findings.find((f) => f.rule === "name-verb");
  assert.equal(asDefault.severity, "warn");

  const raised = resolveConfig({ rules: { "name-verb": "error" } });
  assert.equal(lintTools(tools, raised).findings.find((f) => f.rule === "name-verb").severity, "error");

  const disabled = resolveConfig({ rules: { "name-verb": "off" } });
  assert.equal(lintTools(tools, disabled).findings.some((f) => f.rule === "name-verb"), false);

  // defaultConfig runs every rule at its documented default severity.
  const generic = lintTools([cleanTool({ name: "run" })], defaultConfig())
    .findings.find((f) => f.rule === "name-generic");
  assert.equal(generic.severity, "error");
});

test("ignoreTools excludes matching tools from findings and totals", () => {
  const tools = [cleanTool(), cleanTool({ name: "legacy_run", description: "TODO" })];
  const config = resolveConfig({ ignoreTools: ["legacy_*"] });
  const result = lintTools(tools, config);
  assert.deepEqual(result.findings, []);
  assert.equal(result.summary.tools, 1);
});

test("findings are sorted by tool, then path, then rule id", () => {
  const tools = [
    cleanTool({ name: "user_report", description: "Report" }), // name-verb + short description
    cleanTool({ name: "run", description: "TODO" }),
  ];
  const result = lintTools(tools);
  const keys = result.findings.map((f) => [f.toolIndex, f.path, f.rule].join("|"));
  assert.deepEqual(keys, [...keys].sort((a, b) => {
    const [ti, pa, ru] = a.split("|");
    const [tj, pb, rv] = b.split("|");
    return Number(ti) - Number(tj) || pa.localeCompare(pb) || ru.localeCompare(rv);
  }));
  assert.ok(result.findings.length >= 4);

  // And linting the same input twice is byte-identical.
  const first = JSON.stringify(lintTools(tools));
  const second = JSON.stringify(lintTools(tools));
  assert.equal(first, second);
});

test("summary counts severities and flagged tools correctly", () => {
  const tools = [
    cleanTool(), // clean
    cleanTool({ name: "run", description: "TODO" }), // errors
  ];
  const { summary } = lintTools(tools);
  assert.equal(summary.tools, 2);
  assert.equal(summary.flaggedTools, 1);
  assert.ok(summary.errors >= 2);
});

test("positional fallback labels use post-ignore positions, matching the report's #N", () => {
  // An ignored tool before a nameless one must not shift the fallback label:
  // the nameless tool is #1 in the linted set, so it is "<tool #1>".
  const tools = [cleanTool({ name: "legacy_run" }), { description: "A tool with no name at all." }];
  const config = resolveConfig({ ignoreTools: ["legacy_*"] });
  const result = lintTools(tools, config);
  const nameless = result.findings.find((f) => f.rule === "name-format");
  assert.equal(nameless.tool, "<tool #1>");
  assert.equal(nameless.toolIndex, 0);
});

test("displayName falls back to a positional label for unusable names", () => {
  assert.equal(displayName({ name: "get_weather" }, 3), "get_weather");
  assert.equal(displayName({ name: 42 }, 3), "<tool #4>");
  assert.equal(displayName({}, 0), "<tool #1>");
});
