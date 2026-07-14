// Formatter tests: pretty grouping and hints, the summary line grammar,
// compact's one-line-per-finding contract, and the JSON document shape.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { formatCompact, formatJson, formatPretty, lintTools, summaryLine } from "../dist/index.js";
import { cleanTool } from "./helpers.mjs";

function messyResults() {
  const tools = [cleanTool(), cleanTool({ name: "run", description: "TODO" })];
  return [{ file: "server.json", result: lintTools(tools) }];
}

test("formatPretty groups findings under file and tool with indented hints", () => {
  const output = formatPretty(messyResults(), false);
  assert.match(output, /^server\.json$/m);
  assert.match(output, /^  run #2$/m);
  assert.match(output, /name-generic/);
  assert.match(output, /↳ /);
  assert.doesNotMatch(output, /\u001b\[/); // color=false means zero ANSI codes
  const colored = formatPretty(messyResults(), true);
  assert.match(colored, /\u001b\[31m/); // red for "error"
});

test("summaryLine pluralizes correctly and reports flagged tool coverage", () => {
  const output = summaryLine(messyResults(), false);
  assert.match(output, /^✖ \d+ problems \(\d+ errors?, \d+ warnings?\) in 1 of 2 tools$/);
  const clean = summaryLine([{ file: "x", result: lintTools([cleanTool()]) }], false);
  assert.equal(clean, "✔ 1 tool clean");
});

test("formatCompact emits one grep-friendly line per finding plus the summary", () => {
  const results = messyResults();
  const lines = formatCompact(results).split("\n");
  assert.equal(lines.length, results[0].result.findings.length + 1);
  assert.match(lines[0], /^server\.json:run:\/[^ ]+: (error|warn|info) \[[a-z-]+\] /);
});

test("formatJson produces a parseable document with stable top-level keys", () => {
  const document = JSON.parse(formatJson(messyResults()));
  assert.deepEqual(Object.keys(document), ["toolint", "files", "summary"]);
  assert.equal(document.toolint, "0.1.0");
  assert.equal(document.files[0].file, "server.json");
  const finding = document.files[0].findings.find((f) => f.rule === "name-generic");
  assert.equal(finding.severity, "error");
  assert.equal(typeof finding.hint, "string");
  assert.equal(document.summary.problems, document.summary.errors + document.summary.warnings + document.summary.infos);
});

test("formatJson totals aggregate across multiple files", () => {
  const results = [
    { file: "a.json", result: lintTools([cleanTool()]) },
    { file: "b.json", result: lintTools([cleanTool({ name: "run" })]) },
  ];
  const document = JSON.parse(formatJson(results));
  assert.equal(document.summary.tools, 2);
  assert.ok(document.summary.errors >= 1);
});
