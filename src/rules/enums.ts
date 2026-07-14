/**
 * Enum rules.
 *
 * Enums are the strongest steering signal a schema can give a model — when
 * the values mean something. `["option1", "option2"]` gives the model a
 * multiple-choice question with the answers redacted.
 */
import type { RawFinding, Rule, ToolContext } from "../types.js";
import { caseProfile, isVagueEnumValue, quote } from "../text.js";
import { walkSchema } from "../walk.js";

/** Label for messages: parameter name if known, else the path. */
function labelFor(propertyName: string | undefined, path: string): string {
  return propertyName !== undefined ? `parameter "${propertyName}"` : `schema at ${path}`;
}

/** Iterate every enum in the tool's schema with its context. */
function eachEnum(
  ctx: ToolContext,
  visit: (values: unknown[], path: string, propertyName: string | undefined) => void,
): void {
  for (const node of walkSchema(ctx.tool.inputSchema)) {
    const values = node.schema["enum"];
    if (Array.isArray(values)) visit(values, node.path, node.propertyName);
  }
}

export const enumEmpty: Rule = {
  id: "enum-empty",
  category: "enum",
  defaultSeverity: "error",
  scope: "tool",
  summary: "An enum has no values — nothing can satisfy it.",
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    eachEnum(ctx, (values, path, propertyName) => {
      if (values.length > 0) return;
      findings.push({
        path: `${path}/enum`,
        message: `${labelFor(propertyName, path)} has an empty enum — no value can ever validate`,
        hint: "list the allowed values, or drop the enum",
      });
    });
    return findings;
  },
};

export const enumSingle: Rule = {
  id: "enum-single",
  category: "enum",
  defaultSeverity: "info",
  scope: "tool",
  summary: "An enum allows exactly one value.",
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    eachEnum(ctx, (values, path, propertyName) => {
      if (values.length !== 1) return;
      findings.push({
        path: `${path}/enum`,
        message: `${labelFor(propertyName, path)} allows exactly one value (${quote(values[0])}) — it is a constant, not a choice`,
        hint: "use \"const\" if intended, or fill it server-side and remove the parameter",
      });
    });
    return findings;
  },
};

export const enumDuplicate: Rule = {
  id: "enum-duplicate",
  category: "enum",
  defaultSeverity: "error",
  scope: "tool",
  summary: "An enum repeats a value, or holds case-only variants of one.",
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    eachEnum(ctx, (values, path, propertyName) => {
      const seen = new Map<string, unknown>();
      for (const value of values) {
        const key = typeof value === "string" ? `s:${value.toLowerCase()}` : `j:${JSON.stringify(value)}`;
        const first = seen.get(key);
        if (first === undefined && !seen.has(key)) {
          seen.set(key, value);
          continue;
        }
        const exact = JSON.stringify(first) === JSON.stringify(value);
        findings.push({
          path: `${path}/enum`,
          message: exact
            ? `${labelFor(propertyName, path)} repeats enum value ${quote(value)}`
            : `${labelFor(propertyName, path)} holds both ${quote(first)} and ${quote(value)} — case-only variants the model must coin-flip between`,
          hint: "keep exactly one canonical spelling per meaning and normalize server-side",
        });
      }
    });
    return findings;
  },
};

export const enumVague: Rule = {
  id: "enum-vague",
  category: "enum",
  defaultSeverity: "warn",
  scope: "tool",
  summary: "Enum values name slots, not meanings (`option1`, `type_a`, `\"2\"`, single letters).",
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    eachEnum(ctx, (values, path, propertyName) => {
      const vague = values.filter((v): v is string => typeof v === "string" && isVagueEnumValue(v));
      if (vague.length === 0) return;
      const listed = vague.slice(0, 4).map((v) => quote(v)).join(", ");
      const suffix = vague.length > 4 ? `, +${vague.length - 4} more` : "";
      findings.push({
        path: `${path}/enum`,
        message: `${labelFor(propertyName, path)} has ${vague.length === values.length ? "only " : ""}vague enum value${vague.length === 1 ? "" : "s"}: ${listed}${suffix}`,
        hint: "name what each value does (\"fast_draft\", \"high_quality\"), not its position in a list",
      });
    });
    return findings;
  },
};

export const enumMixedTypes: Rule = {
  id: "enum-mixed-types",
  category: "enum",
  defaultSeverity: "warn",
  scope: "tool",
  summary: "An enum mixes strings and numbers.",
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    eachEnum(ctx, (values, path, propertyName) => {
      const hasString = values.some((v) => typeof v === "string");
      const hasNumber = values.some((v) => typeof v === "number");
      if (!hasString || !hasNumber) return;
      findings.push({
        path: `${path}/enum`,
        message: `${labelFor(propertyName, path)} mixes strings and numbers in one enum — models routinely send "3" for 3 and vice versa`,
        hint: "pick one JSON type for every value in the enum",
      });
    });
    return findings;
  },
};

export const enumInconsistentCase: Rule = {
  id: "enum-inconsistent-case",
  category: "enum",
  defaultSeverity: "warn",
  scope: "tool",
  summary: "String enum values mix case or separator conventions.",
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    eachEnum(ctx, (values, path, propertyName) => {
      const strings = values.filter((v): v is string => typeof v === "string" && /[a-zA-Z]/.test(v));
      if (strings.length < 2) return;
      const profiles = strings.map(caseProfile);
      const mixedCase = profiles.some((p) => p.hasUpper) && profiles.some((p) => p.allLower);
      const mixedSeparator = profiles.some((p) => p.usesUnderscore) && profiles.some((p) => p.usesHyphen);
      if (!mixedCase && !mixedSeparator) return;
      const why = [mixedCase ? "case" : "", mixedSeparator ? "separator" : ""].filter(Boolean).join(" and ");
      findings.push({
        path: `${path}/enum`,
        message: `${labelFor(propertyName, path)} mixes ${why} conventions across enum values — models normalize toward one style and miss the odd ones out`,
        hint: "use one convention (lower snake_case travels best) for every value",
      });
    });
    return findings;
  },
};

export const enumLarge: Rule = {
  id: "enum-large",
  category: "enum",
  defaultSeverity: "info",
  scope: "tool",
  summary: "An enum has more than `max` values (default 24).",
  optionDefaults: { max: 24 },
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    const max = ctx.options["max"] ?? 24;
    eachEnum(ctx, (values, path, propertyName) => {
      if (values.length <= max) return;
      findings.push({
        path: `${path}/enum`,
        message: `${labelFor(propertyName, path)} enumerates ${values.length} values (threshold ${max}) — every one is sent with every request`,
        hint: "if the list is open-ended, take a free string and validate server-side with a helpful error",
      });
    });
    return findings;
  },
};

export const enumRules: Rule[] = [
  enumEmpty,
  enumSingle,
  enumDuplicate,
  enumVague,
  enumMixedTypes,
  enumInconsistentCase,
  enumLarge,
];
