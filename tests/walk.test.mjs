// Unit tests for the schema walker: paths, property depths, combinator
// handling, pointer escaping, and the recursion guard that keeps
// adversarial schemas from blowing the stack.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { escapePointer, hasTypeInformation, walkSchema } from "../dist/index.js";

test("walkSchema visits root and named properties with correct depth, and skips non-objects", () => {
  const nodes = walkSchema({
    type: "object",
    properties: {
      city: { type: "string" },
      window: { type: "object", properties: { days: { type: "integer" } } },
    },
  });
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  assert.equal(byPath.get("/inputSchema").isRoot, true);
  assert.equal(byPath.get("/inputSchema/properties/city").depth, 1);
  assert.equal(byPath.get("/inputSchema/properties/city").propertyName, "city");
  assert.equal(byPath.get("/inputSchema/properties/window/properties/days").depth, 2);

  assert.deepEqual(walkSchema(undefined), []);
  assert.deepEqual(walkSchema("not a schema"), []);
  assert.deepEqual(walkSchema([1, 2, 3]), []);
});

test("combinator branches keep the parent property's name and depth", () => {
  const nodes = walkSchema({
    type: "object",
    properties: {
      target: { anyOf: [{ type: "string" }, { type: "integer" }] },
    },
  });
  const branch = nodes.find((node) => node.path === "/inputSchema/properties/target/anyOf/0");
  assert.equal(branch.propertyName, "target");
  assert.equal(branch.depth, 1);
});

test("array items and typed additionalProperties are visited", () => {
  const nodes = walkSchema({
    type: "object",
    properties: {
      tags: { type: "array", items: { type: "string" } },
      labels: { type: "object", additionalProperties: { type: "string" } },
    },
  });
  const paths = nodes.map((node) => node.path);
  assert.ok(paths.includes("/inputSchema/properties/tags/items"));
  assert.ok(paths.includes("/inputSchema/properties/labels/additionalProperties"));
});

test("walkSchema survives a pathologically deep schema without throwing", () => {
  let schema = { type: "string" };
  for (let i = 0; i < 64; i++) {
    schema = { type: "object", properties: { nested: schema } };
  }
  const nodes = walkSchema(schema);
  assert.ok(nodes.length > 0);
  assert.ok(nodes.length < 64); // the guard stopped the descent
});

test("escapePointer escapes ~ and / per RFC 6901", () => {
  assert.equal(escapePointer("a/b~c"), "a~1b~0c");
  assert.equal(escapePointer("plain"), "plain");
});

test("hasTypeInformation accepts type, enum, const, $ref, and combinators", () => {
  assert.equal(hasTypeInformation({ type: "string" }), true);
  assert.equal(hasTypeInformation({ enum: ["a"] }), true);
  assert.equal(hasTypeInformation({ const: 1 }), true);
  assert.equal(hasTypeInformation({ $ref: "#/definitions/x" }), true);
  assert.equal(hasTypeInformation({ anyOf: [] }), true);
  assert.equal(hasTypeInformation({ description: "typed by vibes" }), false);
});
