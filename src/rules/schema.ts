/**
 * Schema-shape rules.
 *
 * These check the structural properties that decide whether a model can
 * fill in arguments reliably: typed parameters, no free-form objects, sane
 * parameter counts, shallow nesting, unambiguous parameter names, positive
 * booleans, and defaults that actually satisfy their own schema.
 */
import type { RawFinding, Rule, ToolContext } from "../types.js";
import { isAmbiguousParam, isNegatedBoolean, quote, wordCount } from "../text.js";
import { hasTypeInformation, isRecord, walkSchema, type SchemaNode } from "../walk.js";

export const schemaMissing: Rule = {
  id: "schema-missing",
  category: "schema",
  defaultSeverity: "error",
  scope: "tool",
  summary: "Tool has no inputSchema object.",
  checkTool(ctx: ToolContext): RawFinding[] {
    if (isRecord(ctx.tool.inputSchema)) return [];
    return [{
      path: "/inputSchema",
      message: "tool has no inputSchema — clients and models cannot know what arguments it takes",
      hint: "declare an object schema; a tool without parameters is {\"type\": \"object\", \"properties\": {}}",
    }];
  },
};

export const schemaRootType: Rule = {
  id: "schema-root-type",
  category: "schema",
  defaultSeverity: "error",
  scope: "tool",
  summary: "Root inputSchema must declare `\"type\": \"object\"`.",
  checkTool(ctx: ToolContext): RawFinding[] {
    const schema = ctx.tool.inputSchema;
    if (!isRecord(schema)) return []; // schema-missing already fires
    const type = schema["type"];
    if (type === "object") return [];
    const message = type === undefined
      ? "root inputSchema does not declare a type"
      : `root inputSchema declares type ${quote(type)} — tool arguments are always a JSON object`;
    return [{
      path: "/inputSchema/type",
      message,
      hint: "set \"type\": \"object\" at the root and model each argument as a named property",
    }];
  },
};

export const paramTypeMissing: Rule = {
  id: "param-type-missing",
  category: "schema",
  defaultSeverity: "warn",
  scope: "tool",
  summary: "A property gives the model no type information (no type/enum/const/$ref/combinator).",
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    for (const node of walkSchema(ctx.tool.inputSchema)) {
      if (node.propertyName === undefined) continue;
      if (hasTypeInformation(node.schema)) continue;
      findings.push({
        path: node.path,
        message: `parameter "${node.propertyName}" has no type — the model will improvise one`,
        hint: "declare \"type\" (or enum/const) so argument validation can reject bad calls early",
      });
    }
    return findings;
  },
};

export const freeFormObject: Rule = {
  id: "free-form-object",
  category: "schema",
  defaultSeverity: "warn",
  scope: "tool",
  summary: "An object property declares no `properties` — the model must invent keys.",
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    for (const node of walkSchema(ctx.tool.inputSchema)) {
      if (node.isRoot) continue; // a bare {"type":"object"} root is a valid zero-arg tool
      if (node.schema["type"] !== "object") continue;
      if (isRecord(node.schema["properties"])) continue;
      if (isRecord(node.schema["additionalProperties"])) continue; // typed map: fine
      if ("$ref" in node.schema || "patternProperties" in node.schema) continue;
      const label = node.propertyName !== undefined ? `parameter "${node.propertyName}"` : `schema at ${node.path}`;
      findings.push({
        path: node.path,
        message: `${label} is a free-form object — the model has to invent its keys`,
        hint: "enumerate the expected keys under \"properties\", or use a typed \"additionalProperties\" schema for maps",
      });
    }
    return findings;
  },
};

export const arrayMissingItems: Rule = {
  id: "array-missing-items",
  category: "schema",
  defaultSeverity: "warn",
  scope: "tool",
  summary: "An array property does not say what its items are.",
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    for (const node of walkSchema(ctx.tool.inputSchema)) {
      if (node.schema["type"] !== "array") continue;
      if ("items" in node.schema || "prefixItems" in node.schema || "contains" in node.schema) continue;
      const label = node.propertyName !== undefined ? `parameter "${node.propertyName}"` : `array at ${node.path}`;
      findings.push({
        path: node.path,
        message: `${label} is an array with no "items" schema`,
        hint: "declare the element schema so the model knows what to put inside",
      });
    }
    return findings;
  },
};

export const requiredUndeclared: Rule = {
  id: "required-undeclared",
  category: "schema",
  defaultSeverity: "error",
  scope: "tool",
  summary: "`required` lists a property that is not declared under `properties`.",
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    for (const node of walkSchema(ctx.tool.inputSchema)) {
      const required = node.schema["required"];
      if (!Array.isArray(required)) continue;
      const properties = node.schema["properties"];
      const declared = isRecord(properties) ? new Set(Object.keys(properties)) : new Set<string>();
      for (const entry of required) {
        if (typeof entry !== "string") {
          findings.push({
            path: `${node.path}/required`,
            message: `"required" contains a non-string entry (${quote(entry)})`,
            hint: "\"required\" must be an array of property names",
          });
          continue;
        }
        if (!declared.has(entry)) {
          findings.push({
            path: `${node.path}/required`,
            message: `"required" lists "${entry}", which is not declared under "properties"`,
            hint: "the model is told a parameter is mandatory but given no schema for it; declare it or drop it",
          });
        }
      }
    }
    return findings;
  },
};

export const tooManyParams: Rule = {
  id: "too-many-params",
  category: "schema",
  defaultSeverity: "warn",
  scope: "tool",
  summary: "More than `max` top-level parameters (default 10).",
  optionDefaults: { max: 10 },
  checkTool(ctx: ToolContext): RawFinding[] {
    const schema = ctx.tool.inputSchema;
    if (!isRecord(schema)) return [];
    const properties = schema["properties"];
    if (!isRecord(properties)) return [];
    const count = Object.keys(properties).length;
    const max = ctx.options["max"] ?? 10;
    if (count <= max) return [];
    return [{
      path: "/inputSchema/properties",
      message: `tool takes ${count} top-level parameters (threshold ${max}) — argument accuracy drops as the surface grows`,
      hint: "split the tool by use case, or group rarely-used flags into one well-described optional object",
    }];
  },
};

export const deepNesting: Rule = {
  id: "deep-nesting",
  category: "schema",
  defaultSeverity: "warn",
  scope: "tool",
  summary: "Properties nested deeper than `max` levels (default 3).",
  optionDefaults: { max: 3 },
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    const max = ctx.options["max"] ?? 3;
    for (const node of walkSchema(ctx.tool.inputSchema)) {
      // Report only the first offending level so one deep branch yields one
      // finding instead of a cascade.
      if (node.propertyName === undefined || node.depth !== max + 1) continue;
      findings.push({
        path: node.path,
        message: `parameter "${node.propertyName}" sits ${node.depth} levels deep — models frequently misplace deeply nested keys`,
        hint: "flatten the schema; dotted top-level names beat deep object trees for argument accuracy",
      });
    }
    return findings;
  },
};

export const paramNameAmbiguous: Rule = {
  id: "param-name-ambiguous",
  category: "schema",
  defaultSeverity: "warn",
  scope: "tool",
  summary: "A parameter has a guess-inviting name (`data`, `value`, `options`) and no real description.",
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    for (const node of walkSchema(ctx.tool.inputSchema)) {
      if (node.propertyName === undefined || !isAmbiguousParam(node.propertyName)) continue;
      const description = node.schema["description"];
      const documented = typeof description === "string" && wordCount(description) >= 4;
      if (documented) continue; // a precise description redeems a vague name
      findings.push({
        path: node.path,
        message: `parameter "${node.propertyName}" is a catch-all name with no real description — the model will guess its contents`,
        hint: `rename it to what it holds (e.g. "query_text", "user_id"), or describe it precisely`,
      });
    }
    return findings;
  },
};

export const booleanNegated: Rule = {
  id: "boolean-negated",
  category: "schema",
  defaultSeverity: "warn",
  scope: "tool",
  summary: "A boolean parameter is phrased as a negation (`no_cache`, `disable_x`).",
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    for (const node of walkSchema(ctx.tool.inputSchema)) {
      if (node.propertyName === undefined) continue;
      if (node.schema["type"] !== "boolean") continue;
      if (!isNegatedBoolean(node.propertyName)) continue;
      findings.push({
        path: node.path,
        message: `boolean "${node.propertyName}" is phrased as a negation — "${node.propertyName}": false is a double negative`,
        hint: "phrase booleans positively (\"use_cache\", \"enabled\") and set the default accordingly",
      });
    }
    return findings;
  },
};

export const defaultMismatch: Rule = {
  id: "default-mismatch",
  category: "schema",
  defaultSeverity: "error",
  scope: "tool",
  summary: "A declared `default` violates its own enum or type.",
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    for (const node of walkSchema(ctx.tool.inputSchema)) {
      if (!("default" in node.schema)) continue;
      const value = node.schema["default"];
      const label = node.propertyName !== undefined ? `parameter "${node.propertyName}"` : `schema at ${node.path}`;
      const allowed = node.schema["enum"];
      if (Array.isArray(allowed) && !allowed.some((entry) => deepEqual(entry, value))) {
        findings.push({
          path: `${node.path}/default`,
          message: `${label} defaults to ${quote(value)}, which is not one of its enum values`,
          hint: "the model copies defaults into calls; a default outside the enum guarantees invalid arguments",
        });
        continue;
      }
      const type = node.schema["type"];
      if (typeof type === "string" && !matchesType(value, type)) {
        findings.push({
          path: `${node.path}/default`,
          message: `${label} defaults to ${quote(value)}, which is not of declared type "${type}"`,
          hint: "fix the default or the type; the two disagreeing teaches the model the wrong shape",
        });
      }
    }
    return findings;
  },
};

/** Does a JSON value satisfy a JSON-Schema primitive type name? */
function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value);
    case "object": return isRecord(value);
    case "null": return value === null;
    default: return true; // unknown type names are not this rule's business
  }
}

/** Structural equality for JSON values (enums may hold arrays/objects). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export const unionOverload: Rule = {
  id: "union-overload",
  category: "schema",
  defaultSeverity: "warn",
  scope: "tool",
  summary: "Root-level anyOf/oneOf, or a property union with more than `maxBranches` branches (default 3).",
  optionDefaults: { maxBranches: 3 },
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    const maxBranches = ctx.options["maxBranches"] ?? 3;
    for (const node of walkSchema(ctx.tool.inputSchema)) {
      for (const keyword of ["anyOf", "oneOf"] as const) {
        const branches = node.schema[keyword];
        if (!Array.isArray(branches)) continue;
        if (node.isRoot) {
          findings.push({
            path: `/inputSchema/${keyword}`,
            message: `root inputSchema is a ${keyword} of ${branches.length} variants — the model must pick a calling convention before it picks arguments`,
            hint: "split each variant into its own tool, or use a discriminator enum plus optional fields",
          });
        } else if (branches.length > maxBranches) {
          const label = node.propertyName !== undefined ? `parameter "${node.propertyName}"` : `schema at ${node.path}`;
          findings.push({
            path: `${node.path}/${keyword}`,
            message: `${label} is a ${keyword} of ${branches.length} branches (threshold ${maxBranches})`,
            hint: "collapse branches or document which branch applies when",
          });
        }
      }
    }
    return findings;
  },
};

/** One SchemaNode-based helper is re-exported for tests. */
export type { SchemaNode };

export const schemaRules: Rule[] = [
  schemaMissing,
  schemaRootType,
  paramTypeMissing,
  freeFormObject,
  arrayMissingItems,
  requiredUndeclared,
  tooManyParams,
  deepNesting,
  paramNameAmbiguous,
  booleanNegated,
  defaultMismatch,
  unionOverload,
];
