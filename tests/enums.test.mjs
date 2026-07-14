// Rule tests: enums — emptiness, singletons, duplicates and case
// variants, vague values, mixed JSON types, mixed conventions, and size.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { cleanTool, findingsFor } from "./helpers.mjs";

/** A clean tool whose only parameter is an enum with the given values. */
function withEnum(values) {
  return cleanTool({
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: values, description: "Which processing mode to use." },
      },
    },
  });
}

test("enum-empty errors and enum-single is an info suggesting const", async () => {
  const empty = await findingsFor([withEnum([])], "enum-empty");
  assert.equal(empty.length, 1);
  assert.equal(empty[0].severity, "error");
  assert.equal(empty[0].path, "/inputSchema/properties/mode/enum");

  const single = await findingsFor([withEnum(["exactly_this"])], "enum-single");
  assert.equal(single.length, 1);
  assert.equal(single[0].severity, "info");
  assert.match(single[0].hint, /const/);
});

test("enum-duplicate errors on exact repeats and case-only variants", async () => {
  const exact = await findingsFor([withEnum(["fast", "thorough", "fast"])], "enum-duplicate");
  assert.equal(exact.length, 1);
  assert.match(exact[0].message, /repeats enum value "fast"/);

  const caseVariant = await findingsFor([withEnum(["pdf", "PDF"])], "enum-duplicate");
  assert.equal(caseVariant.length, 1);
  assert.match(caseVariant[0].message, /"pdf".*"PDF"/);
  assert.match(caseVariant[0].message, /coin-flip/);
});

test("enum-vague lists slot-name offenders and stays quiet for meaningful values", async () => {
  const findings = await findingsFor([withEnum(["option1", "option2", "detailed"])], "enum-vague");
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /"option1", "option2"/);
  assert.doesNotMatch(findings[0].message, /"detailed"/);
  assert.deepEqual(await findingsFor([withEnum(["draft", "final", "archived"])], "enum-vague"), []);
});

test("enum-mixed-types warns when strings and numbers share one enum", async () => {
  const findings = await findingsFor([withEnum(["low", 2, "high"])], "enum-mixed-types");
  assert.equal(findings.length, 1);
  assert.deepEqual(await findingsFor([withEnum(["low", "high"])], "enum-mixed-types"), []);
});

test("enum-inconsistent-case warns on mixed case and mixed separators", async () => {
  const mixedCase = await findingsFor([withEnum(["fast", "Slow"])], "enum-inconsistent-case");
  assert.equal(mixedCase.length, 1);
  assert.match(mixedCase[0].message, /case/);
  const mixedSep = await findingsFor([withEnum(["fast_draft", "high-quality"])], "enum-inconsistent-case");
  assert.equal(mixedSep.length, 1);
  assert.match(mixedSep[0].message, /separator/);
});

test("enum-inconsistent-case accepts one consistent convention", async () => {
  for (const values of [["fast_draft", "high_quality"], ["fastDraft", "highQuality"], ["FAST", "SLOW"]]) {
    assert.deepEqual(await findingsFor([withEnum(values)], "enum-inconsistent-case"), [], values.join(","));
  }
});

test("enum-large is an info finding past the size threshold, configurable", async () => {
  const values = Array.from({ length: 25 }, (_, i) => `country_${String.fromCharCode(97 + (i % 26))}${i}`);
  const findings = await findingsFor([withEnum(values)], "enum-large");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "info");
  const { resolveConfig } = await import("../dist/index.js");
  const config = resolveConfig({ rules: { "enum-large": { options: { max: 30 } } } });
  assert.deepEqual(await findingsFor([withEnum(values)], "enum-large", config), []);
});
