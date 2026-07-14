/**
 * The rule registry: every built-in rule, in the order they are listed by
 * `toolint --rules` and documented in docs/rules.md.
 */
import type { Rule } from "../types.js";
import { namingRules } from "./naming.js";
import { descriptionRules } from "./descriptions.js";
import { schemaRules } from "./schema.js";
import { enumRules } from "./enums.js";

/** All built-in rules, grouped by category. */
export const ALL_RULES: readonly Rule[] = [
  ...namingRules,
  ...descriptionRules,
  ...schemaRules,
  ...enumRules,
];

/** Lookup by rule id. */
export const RULES_BY_ID: ReadonlyMap<string, Rule> = new Map(
  ALL_RULES.map((rule) => [rule.id, rule]),
);

export { namingRules } from "./naming.js";
export { descriptionRules } from "./descriptions.js";
export { schemaRules } from "./schema.js";
export { enumRules } from "./enums.js";
