// Rule tests: schema shape — missing schemas, root type, untyped and
// free-form parameters, required consistency, size/nesting thresholds,
// ambiguous names, negated booleans, defaults, and unions.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { cleanTool, findingsFor } from "./helpers.mjs";

/** A clean tool with the given top-level properties patched in. */
function withProps(properties, extraSchema = {}) {
  return cleanTool({ inputSchema: { type: "object", properties, ...extraSchema } });
}

test("schema-missing errors when inputSchema is absent or not an object", async () => {
  for (const inputSchema of [undefined, "object", []]) {
    const findings = await findingsFor([cleanTool({ inputSchema })], "schema-missing");
    assert.equal(findings.length, 1, JSON.stringify(inputSchema));
    assert.equal(findings[0].severity, "error");
  }
});

test("schema-root-type errors on a non-object root and an undeclared type", async () => {
  const typed = await findingsFor([cleanTool({ inputSchema: { type: "string" } })], "schema-root-type");
  assert.equal(typed.length, 1);
  assert.match(typed[0].message, /"string"/);
  const untyped = await findingsFor([cleanTool({ inputSchema: { properties: {} } })], "schema-root-type");
  assert.equal(untyped.length, 1);
  assert.match(untyped[0].message, /does not declare a type/);
});

test("param-type-missing warns for untyped properties; enum/const/$ref/combinators count as typed", async () => {
  const findings = await findingsFor([withProps({ city: { description: "City name to look up." } })], "param-type-missing");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, "/inputSchema/properties/city");

  const typed = withProps({
    unit: { enum: ["celsius", "fahrenheit"], description: "Temperature unit for the response." },
    kind: { const: "forecast", description: "Fixed request kind." },
    place: { $ref: "#/definitions/place", description: "Where to look up the weather." },
    when: { anyOf: [{ type: "string" }], description: "Date or datetime of the forecast." },
  });
  assert.deepEqual(await findingsFor([typed], "param-type-missing"), []);
});

test("free-form-object warns on property objects without properties, but not the root", async () => {
  const zeroArg = cleanTool({ inputSchema: { type: "object", properties: {} } });
  assert.deepEqual(await findingsFor([zeroArg], "free-form-object"), []);
  const bareRoot = cleanTool({ inputSchema: { type: "object" } });
  assert.deepEqual(await findingsFor([bareRoot], "free-form-object"), []);

  const findings = await findingsFor(
    [withProps({ data: { type: "object", description: "Arbitrary extra data." } })],
    "free-form-object",
  );
  assert.equal(findings.length, 1);

  // A typed map via additionalProperties is a legitimate shape.
  const typedMap = withProps({
    headers: {
      type: "object",
      description: "HTTP headers to send, name to value.",
      additionalProperties: { type: "string" },
    },
  });
  assert.deepEqual(await findingsFor([typedMap], "free-form-object"), []);
});

test("array-missing-items warns on arrays without items or prefixItems", async () => {
  const bare = withProps({ tags: { type: "array", description: "Tags to attach to the record." } });
  assert.equal((await findingsFor([bare], "array-missing-items")).length, 1);
  const typed = withProps({
    tags: { type: "array", description: "Tags to attach to the record.", items: { type: "string", description: "One tag." } },
  });
  assert.deepEqual(await findingsFor([typed], "array-missing-items"), []);
});

test("required-undeclared errors for phantom and non-string required entries", async () => {
  const tool = withProps(
    { city: { type: "string", description: "City name to look up." } },
    { required: ["city", "country", 7] },
  );
  const findings = await findingsFor([tool], "required-undeclared");
  assert.equal(findings.length, 2);
  assert.match(findings[0].message, /non-string/);
  assert.match(findings[1].message, /"country"/);
});

test("too-many-params counts top-level properties against the threshold", async () => {
  const properties = {};
  for (let i = 0; i < 11; i++) {
    properties[`field_${String.fromCharCode(97 + i)}`] = { type: "string", description: `Field ${i} of the record.` };
  }
  const findings = await findingsFor([withProps(properties)], "too-many-params");
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /11 top-level parameters/);
  const { resolveConfig } = await import("../dist/index.js");
  const config = resolveConfig({ rules: { "too-many-params": { options: { max: 11 } } } });
  assert.deepEqual(await findingsFor([withProps(properties)], "too-many-params", config), []);
});

test("deep-nesting reports the first level past the threshold exactly once", async () => {
  const tool = withProps({
    a: {
      type: "object",
      description: "Level one.",
      properties: {
        b: {
          type: "object",
          description: "Level two.",
          properties: {
            c: {
              type: "object",
              description: "Level three.",
              properties: {
                d: {
                  type: "object",
                  description: "Level four.",
                  properties: { e: { type: "string", description: "Level five." } },
                },
              },
            },
          },
        },
      },
    },
  });
  const findings = await findingsFor([tool], "deep-nesting");
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /"d"/);
});

test("param-name-ambiguous warns on catch-all names, unless well documented", async () => {
  const bare = withProps({ data: { type: "string" } });
  assert.equal((await findingsFor([bare], "param-name-ambiguous")).length, 1);
  const documented = withProps({
    data: { type: "string", description: "Base64-encoded PNG bytes of the chart to upload." },
  });
  assert.deepEqual(await findingsFor([documented], "param-name-ambiguous"), []);
});

test("boolean-negated warns on negated booleans but not on non-boolean fields", async () => {
  const negated = withProps({ no_cache: { type: "boolean", description: "Skip the response cache when true." } });
  assert.equal((await findingsFor([negated], "boolean-negated")).length, 1);
  const stringField = withProps({ no_reply_address: { type: "string", description: "Address used for outgoing mail." } });
  assert.deepEqual(await findingsFor([stringField], "boolean-negated"), []);
});

test("default-mismatch errors when the default violates the enum or the type", async () => {
  const offEnum = withProps({
    mode: { type: "string", enum: ["fast", "thorough"], default: "quick", description: "Search mode." },
  });
  const enumFindings = await findingsFor([offEnum], "default-mismatch");
  assert.equal(enumFindings.length, 1);
  assert.match(enumFindings[0].message, /not one of its enum values/);

  const offType = withProps({
    limit: { type: "integer", default: "10", description: "Maximum rows to return." },
  });
  const typeFindings = await findingsFor([offType], "default-mismatch");
  assert.equal(typeFindings.length, 1);
  assert.match(typeFindings[0].message, /declared type "integer"/);

  const fine = withProps({
    limit: { type: "integer", default: 10, description: "Maximum rows to return." },
  });
  assert.deepEqual(await findingsFor([fine], "default-mismatch"), []);
});

test("union-overload flags a root-level oneOf and oversized property unions", async () => {
  const rootUnion = cleanTool({
    inputSchema: { type: "object", oneOf: [{ required: ["a"] }, { required: ["b"] }] },
  });
  const rootFindings = await findingsFor([rootUnion], "union-overload");
  assert.equal(rootFindings.length, 1);
  assert.match(rootFindings[0].message, /calling convention/);

  const wide = withProps({
    target: {
      description: "One of five differently-shaped targets.",
      anyOf: [{ type: "string" }, { type: "integer" }, { type: "boolean" }, { type: "array" }, { type: "object" }],
    },
  });
  const wideFindings = await findingsFor([wide], "union-overload");
  assert.equal(wideFindings.length, 1);
  assert.match(wideFindings[0].message, /5 branches/);
});
