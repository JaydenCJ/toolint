// Rule tests: naming. Each test lints a small fixture through the real
// engine and asserts on the findings for exactly one rule, so a change in
// any other rule cannot break these.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { cleanTool, findingsFor } from "./helpers.mjs";

test("name-format fires for a missing name", async () => {
  const findings = await findingsFor([cleanTool({ name: undefined })], "name-format");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, "/name");
  assert.equal(findings[0].severity, "error");
  assert.equal(findings[0].tool, "<tool #1>");
});

test("name-format fires for exotic characters but accepts the MCP-safe set", async () => {
  const findings = await findingsFor([cleanTool({ name: "search notes!" })], "name-format");
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /space/);
  assert.deepEqual(await findingsFor([cleanTool({ name: "files.read_v2-beta" })], "name-format"), []);
});

test("name-length warns past 64 characters and respects the option", async () => {
  const long = `get_${"x".repeat(70)}`;
  assert.equal((await findingsFor([cleanTool({ name: long })], "name-length")).length, 1);
  const { resolveConfig } = await import("../dist/index.js");
  const config = resolveConfig({ rules: { "name-length": { options: { max: 100 } } } });
  assert.deepEqual(await findingsFor([cleanTool({ name: long })], "name-length", config), []);
});

test("name-casing flags snake_case mixed with camelCase", async () => {
  const findings = await findingsFor([cleanTool({ name: "get_userInfo" })], "name-casing");
  assert.equal(findings.length, 1);
  assert.match(findings[0].hint, /"get_user_info"/);
  assert.deepEqual(await findingsFor([cleanTool({ name: "getUserInfo" })], "name-casing"), []);
  assert.deepEqual(await findingsFor([cleanTool({ name: "get_user_info" })], "name-casing"), []);
});

test("name-verb warns on noun-first names but not verb-first ones", async () => {
  const findings = await findingsFor([cleanTool({ name: "user_delete" })], "name-verb");
  assert.equal(findings.length, 1);
  assert.match(findings[0].hint, /"delete_user"/);
  for (const name of ["get_weather", "listFiles", "summarize-document"]) {
    assert.deepEqual(await findingsFor([cleanTool({ name })], "name-verb"), [], name);
  }
});

test("name-verb does not double-report generic names", async () => {
  assert.deepEqual(await findingsFor([cleanTool({ name: "handler" })], "name-verb"), []);
  assert.equal((await findingsFor([cleanTool({ name: "handler" })], "name-generic")).length, 1);
});

test("name-generic errors on filler names, including numbered ones", async () => {
  for (const name of ["run", "execute", "tool1", "do_it"]) {
    const findings = await findingsFor([cleanTool({ name })], "name-generic");
    assert.equal(findings.length, 1, name);
    assert.equal(findings[0].severity, "error");
  }
});

test("name-collision errors when two names differ only by case or separators", async () => {
  const tools = [cleanTool({ name: "DocSearch" }), cleanTool({ name: "doc_search" })];
  const findings = await findingsFor(tools, "name-collision");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].toolIndex, 1); // reported on the later duplicate
  assert.match(findings[0].message, /"DocSearch"/);
});

test("name-similar warns on reordered words and one-edit neighbors", async () => {
  const reordered = await findingsFor(
    [cleanTool({ name: "file_delete" }), cleanTool({ name: "delete_file" })],
    "name-similar",
  );
  assert.equal(reordered.length, 1);
  assert.match(reordered[0].message, /different order/);

  const oneEdit = await findingsFor(
    [cleanTool({ name: "get_user" }), cleanTool({ name: "get_users" })],
    "name-similar",
  );
  assert.equal(oneEdit.length, 1);
  assert.match(oneEdit[0].message, /one edit apart/);

  const distinct = [cleanTool({ name: "create_note" }), cleanTool({ name: "archive_note" })];
  assert.deepEqual(await findingsFor(distinct, "name-similar"), []);
});
