// Rule tests: descriptions — the missing/short/placeholder/redundant
// family for tools, the same for parameters, and cross-tool duplicates.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { cleanTool, findingsFor } from "./helpers.mjs";

test("tool-description-missing errors on absent, non-string, and blank descriptions", async () => {
  for (const description of [undefined, 42, "   "]) {
    const findings = await findingsFor([cleanTool({ description })], "tool-description-missing");
    assert.equal(findings.length, 1, JSON.stringify(description));
    assert.equal(findings[0].severity, "error");
  }
});

test("tool-description-short warns under the word threshold, configurable", async () => {
  const findings = await findingsFor([cleanTool({ description: "Searches invoices" })], "tool-description-short");
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /2 words/);
  const { resolveConfig } = await import("../dist/index.js");
  const config = resolveConfig({ rules: { "tool-description-short": { options: { minWords: 2 } } } });
  assert.deepEqual(
    await findingsFor([cleanTool({ description: "Searches invoices" })], "tool-description-short", config),
    [],
  );
});

test("tool-description-placeholder errors on TODO-style copy, and short-circuits the short rule", async () => {
  const tool = cleanTool({ description: "TODO" });
  assert.equal((await findingsFor([tool], "tool-description-placeholder")).length, 1);
  assert.deepEqual(await findingsFor([tool], "tool-description-short"), []);
});

test("tool-description-redundant warns when the description restates the name, but not when it adds information", async () => {
  for (const description of ["Get user", "Gets the user.", "get_user"]) {
    const findings = await findingsFor(
      [cleanTool({ name: "get_user", description })],
      "tool-description-redundant",
    );
    assert.equal(findings.length, 1, description);
  }
  const informative = cleanTool({
    name: "get_user",
    description: "Get a user's profile by id, including email and avatar URL.",
  });
  assert.deepEqual(await findingsFor([informative], "tool-description-redundant"), []);
});

test("tool-description-long is an info finding past the character budget", async () => {
  const tool = cleanTool({ description: `Searches invoices. ${"Very thorough. ".repeat(80)}` });
  const findings = await findingsFor([tool], "tool-description-long");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "info");
});

test("duplicate-description warns on identical descriptions across tools, ignoring case and spacing", async () => {
  const tools = [
    cleanTool({ name: "get_invoice", description: "Fetch one record." }),
    cleanTool({ name: "get_customer", description: "  fetch ONE record. " }),
  ];
  const findings = await findingsFor(tools, "duplicate-description");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].toolIndex, 1);
  assert.match(findings[0].message, /"get_invoice"/);
});

test("param-description-missing warns for undocumented properties at any depth", async () => {
  const tool = cleanTool({
    inputSchema: {
      type: "object",
      properties: {
        filters: {
          type: "object",
          description: "Filters narrowing the search results.",
          properties: { region: { type: "string" } },
        },
      },
    },
  });
  const findings = await findingsFor([tool], "param-description-missing");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, "/inputSchema/properties/filters/properties/region");

  // Combinator branches of a documented property are not re-flagged.
  const documentedUnion = cleanTool({
    inputSchema: {
      type: "object",
      properties: {
        target: {
          description: "A user id (number) or an email address (string).",
          anyOf: [{ type: "integer" }, { type: "string" }],
        },
      },
    },
  });
  assert.deepEqual(await findingsFor([documentedUnion], "param-description-missing"), []);
});

test("param-description-placeholder errors on TODO parameter docs", async () => {
  const tool = cleanTool({
    inputSchema: {
      type: "object",
      properties: { city: { type: "string", description: "tbd" } },
    },
  });
  const findings = await findingsFor([tool], "param-description-placeholder");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "error");
  assert.equal(findings[0].path, "/inputSchema/properties/city/description");
});
