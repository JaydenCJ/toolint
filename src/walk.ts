/**
 * A small JSON-Schema walker tuned for tool input schemas.
 *
 * It visits the root schema, every named property (at any depth), array
 * `items` / `prefixItems`, `additionalProperties` sub-schemas, and every
 * branch of `anyOf` / `oneOf` / `allOf`. It does not resolve `$ref` — a
 * `$ref` node is emitted as-is and rules treat it as opaque.
 */

/** One visited schema node. */
export interface SchemaNode {
  /** The schema object at this location. */
  schema: Record<string, unknown>;
  /** JSON-pointer-like path from the tool root, e.g. `/inputSchema/properties/mode`. */
  path: string;
  /** Set when this node is a named property (`properties.<name>`). */
  propertyName?: string;
  /**
   * Property nesting depth: the root schema is 0, its direct properties
   * are 1, properties of a nested object are 2, and so on. Combinator
   * branches and array items do not add depth; only `properties` does.
   */
  depth: number;
  /** True for the root schema node. */
  isRoot: boolean;
}

/** Hard cap on traversal recursion, to survive adversarial input. */
const MAX_WALK_DEPTH = 32;

/** True for a plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Walk a tool input schema and return every visited node in a stable,
 * document order. Non-object nodes (JSON Schema allows booleans) are
 * skipped silently — there is nothing in them to lint.
 */
export function walkSchema(root: unknown, basePath = "/inputSchema"): SchemaNode[] {
  const nodes: SchemaNode[] = [];
  if (!isRecord(root)) return nodes;

  const visit = (
    schema: Record<string, unknown>,
    path: string,
    depth: number,
    propertyName: string | undefined,
    guard: number,
  ): void => {
    if (guard > MAX_WALK_DEPTH) return;
    nodes.push({ schema, path, depth, isRoot: path === basePath, ...(propertyName !== undefined ? { propertyName } : {}) });

    const properties = schema["properties"];
    if (isRecord(properties)) {
      for (const [name, child] of Object.entries(properties)) {
        if (isRecord(child)) {
          visit(child, `${path}/properties/${escapePointer(name)}`, depth + 1, name, guard + 1);
        }
      }
    }

    const additional = schema["additionalProperties"];
    if (isRecord(additional)) {
      visit(additional, `${path}/additionalProperties`, depth + 1, undefined, guard + 1);
    }

    const items = schema["items"];
    if (isRecord(items)) {
      visit(items, `${path}/items`, depth, undefined, guard + 1);
    } else if (Array.isArray(items)) {
      items.forEach((entry, i) => {
        if (isRecord(entry)) visit(entry, `${path}/items/${i}`, depth, undefined, guard + 1);
      });
    }
    const prefixItems = schema["prefixItems"];
    if (Array.isArray(prefixItems)) {
      prefixItems.forEach((entry, i) => {
        if (isRecord(entry)) visit(entry, `${path}/prefixItems/${i}`, depth, undefined, guard + 1);
      });
    }

    for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
      const branches = schema[keyword];
      if (Array.isArray(branches)) {
        branches.forEach((branch, i) => {
          if (isRecord(branch)) {
            // A combinator branch describes the same property, so it keeps
            // the parent's name and depth.
            visit(branch, `${path}/${keyword}/${i}`, depth, propertyName, guard + 1);
          }
        });
      }
    }
  };

  visit(root, basePath, 0, undefined, 0);
  return nodes;
}

/** Escape `~` and `/` per RFC 6901 so paths stay unambiguous. */
export function escapePointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** True when a schema node has some way for the model to infer a type. */
export function hasTypeInformation(schema: Record<string, unknown>): boolean {
  return (
    "type" in schema ||
    "enum" in schema ||
    "const" in schema ||
    "$ref" in schema ||
    Array.isArray(schema["anyOf"]) ||
    Array.isArray(schema["oneOf"]) ||
    Array.isArray(schema["allOf"])
  );
}
