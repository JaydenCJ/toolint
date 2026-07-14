// Parse tests: every accepted input shape, the schema-field aliases,
// the OpenAI function wrapper, and the exit-2 error paths.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ToolintParseError, parseToolsJson } from "../dist/index.js";

const TOOL = { name: "get_weather", description: "Current weather for a city.", inputSchema: { type: "object", properties: {} } };

test("a bare tool array and a single tool object both parse", () => {
  const fromArray = parseToolsJson(JSON.stringify([TOOL]));
  assert.equal(fromArray.length, 1);
  assert.equal(fromArray[0].name, "get_weather");
  const fromObject = parseToolsJson(JSON.stringify(TOOL));
  assert.equal(fromObject.length, 1);
  assert.equal(fromObject[0].name, "get_weather");
});

test("an MCP tools/list result and a raw JSON-RPC response both parse", () => {
  assert.equal(parseToolsJson(JSON.stringify({ tools: [TOOL] })).length, 1);
  const rpc = { jsonrpc: "2.0", id: 3, result: { tools: [TOOL, TOOL] } };
  assert.equal(parseToolsJson(JSON.stringify(rpc)).length, 2);
});

test("input_schema and parameters are aliases; an explicit inputSchema wins", () => {
  const snake = parseToolsJson(JSON.stringify([{ name: "t_one", input_schema: { type: "object" } }]));
  assert.deepEqual(snake[0].inputSchema, { type: "object" });
  const openai = parseToolsJson(JSON.stringify([{ name: "t_two", parameters: { type: "object" } }]));
  assert.deepEqual(openai[0].inputSchema, { type: "object" });
  const both = parseToolsJson(
    JSON.stringify([{ name: "t", inputSchema: { type: "object" }, parameters: { type: "string" } }]),
  );
  assert.deepEqual(both[0].inputSchema, { type: "object" });
});

test("the OpenAI function wrapper is unwrapped", () => {
  const wrapped = { type: "function", function: { name: "get_weather", parameters: { type: "object" } } };
  const tools = parseToolsJson(JSON.stringify([wrapped]));
  assert.equal(tools[0].name, "get_weather");
  assert.deepEqual(tools[0].inputSchema, { type: "object" });
});

test("malformed tools inside a valid shape do not throw — they get linted", () => {
  const tools = parseToolsJson(JSON.stringify([null, 42, { name: "ok_tool" }]));
  assert.equal(tools.length, 3);
  assert.equal(tools[2].name, "ok_tool");
});

test("invalid JSON and unrecognized shapes raise ToolintParseError naming the source", () => {
  assert.throws(
    () => parseToolsJson("{ nope", "server.json"),
    (error) => error instanceof ToolintParseError && error.message.startsWith("server.json:"),
  );
  assert.throws(() => parseToolsJson(JSON.stringify({ hello: "world" })), /unrecognized shape/);
  assert.throws(() => parseToolsJson("42"), /unrecognized shape/);
});
