/**
 * Input parsing: turn a JSON document into a list of tool definitions.
 *
 * Accepted shapes, checked in order:
 *   1. a bare array of tools                     `[{name, ...}, ...]`
 *   2. an MCP `tools/list` result                `{"tools": [...]}`
 *   3. a raw JSON-RPC response wrapping (2)      `{"result": {"tools": [...]}}`
 *   4. a single tool object                      `{"name": ..., "inputSchema": ...}`
 *
 * OpenAI-style definitions are normalized: `parameters` / `input_schema`
 * are treated as `inputSchema` when `inputSchema` itself is absent, and a
 * `{"type": "function", "function": {...}}` wrapper is unwrapped.
 */
import type { ToolDef } from "./types.js";
import { isRecord } from "./walk.js";

/** Raised for unreadable or unrecognizable input (CLI exit code 2). */
export class ToolintParseError extends Error {
  readonly source: string;
  constructor(source: string, message: string) {
    super(`${source}: ${message}`);
    this.name = "ToolintParseError";
    this.source = source;
  }
}

/** Normalize one raw entry into a ToolDef (schema-field aliases, wrappers). */
function normalizeTool(raw: unknown): ToolDef {
  if (!isRecord(raw)) return { name: undefined, description: undefined, inputSchema: undefined };
  let entry = raw;
  // OpenAI chat-completions wrapper: {"type": "function", "function": {...}}
  const wrapped = entry["function"];
  if (entry["type"] === "function" && isRecord(wrapped)) entry = wrapped;
  const tool: ToolDef = { ...entry };
  if (tool.inputSchema === undefined) {
    if (entry["input_schema"] !== undefined) tool.inputSchema = entry["input_schema"];
    else if (entry["parameters"] !== undefined) tool.inputSchema = entry["parameters"];
  }
  return tool;
}

/** True when an object plausibly is a single tool definition. */
function looksLikeTool(value: Record<string, unknown>): boolean {
  return (
    typeof value["name"] === "string" ||
    "inputSchema" in value ||
    "input_schema" in value ||
    (value["type"] === "function" && isRecord(value["function"]))
  );
}

/**
 * Parse a JSON document into tools. Throws ToolintParseError on invalid
 * JSON or an unrecognized shape; never throws for malformed *tools* —
 * those are what the linter exists to report on.
 */
export function parseToolsJson(text: string, source = "<input>"): ToolDef[] {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ToolintParseError(source, `invalid JSON (${detail})`);
  }

  if (Array.isArray(document)) {
    return document.map(normalizeTool);
  }
  if (isRecord(document)) {
    if (Array.isArray(document["tools"])) {
      return (document["tools"] as unknown[]).map(normalizeTool);
    }
    const result = document["result"];
    if (isRecord(result) && Array.isArray(result["tools"])) {
      return (result["tools"] as unknown[]).map(normalizeTool);
    }
    if (looksLikeTool(document)) {
      return [normalizeTool(document)];
    }
  }
  throw new ToolintParseError(
    source,
    "unrecognized shape — expected a tool array, {\"tools\": [...]}, a tools/list JSON-RPC response, or a single tool object",
  );
}
