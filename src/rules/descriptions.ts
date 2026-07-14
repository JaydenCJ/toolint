/**
 * Description rules.
 *
 * The description is the only channel that tells the model *when* to call
 * a tool and what each argument means. Missing, placeholder, or redundant
 * descriptions push the model into guessing — and it guesses wrong.
 */
import type { RawFinding, Rule, ToolContext, ToolsetContext } from "../types.js";
import { isPlaceholderText, quote, splitWords, wordCount } from "../text.js";
import { isRecord, walkSchema } from "../walk.js";

/** Extract the tool description as trimmed text, or undefined. */
function descriptionOf(ctx: ToolContext): string | undefined {
  const { description } = ctx.tool;
  if (typeof description !== "string") return undefined;
  const trimmed = description.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const toolDescriptionMissing: Rule = {
  id: "tool-description-missing",
  category: "description",
  defaultSeverity: "error",
  scope: "tool",
  summary: "Tool has no description at all.",
  checkTool(ctx: ToolContext): RawFinding[] {
    if (descriptionOf(ctx) !== undefined) return [];
    return [{
      path: "/description",
      message: "tool has no description — the model can only guess when to call it",
      hint: "state what the tool does, when to use it, and what it returns, in one to three sentences",
    }];
  },
};

export const toolDescriptionShort: Rule = {
  id: "tool-description-short",
  category: "description",
  defaultSeverity: "warn",
  scope: "tool",
  summary: "Tool description is under `minWords` words (default 4).",
  optionDefaults: { minWords: 4 },
  checkTool(ctx: ToolContext): RawFinding[] {
    const description = descriptionOf(ctx);
    if (description === undefined || isPlaceholderText(description)) return [];
    const minWords = ctx.options["minWords"] ?? 4;
    const count = wordCount(description);
    if (count >= minWords) return [];
    return [{
      path: "/description",
      message: `description ${quote(description)} is only ${count} word${count === 1 ? "" : "s"} — too thin to disambiguate against other tools`,
      hint: "say when to call this tool and what it returns, not just what it is",
    }];
  },
};

export const toolDescriptionPlaceholder: Rule = {
  id: "tool-description-placeholder",
  category: "description",
  defaultSeverity: "error",
  scope: "tool",
  summary: "Tool description is placeholder copy (TODO, TBD, \"description here\").",
  checkTool(ctx: ToolContext): RawFinding[] {
    const description = descriptionOf(ctx);
    if (description === undefined || !isPlaceholderText(description)) return [];
    return [{
      path: "/description",
      message: `description ${quote(description)} is unfinished placeholder text`,
      hint: "the model will read this literally; replace it before shipping the server",
    }];
  },
};

export const toolDescriptionRedundant: Rule = {
  id: "tool-description-redundant",
  category: "description",
  defaultSeverity: "warn",
  scope: "tool",
  summary: "Tool description merely restates the name and adds no information.",
  checkTool(ctx: ToolContext): RawFinding[] {
    const description = descriptionOf(ctx);
    const name = ctx.tool.name;
    if (description === undefined || typeof name !== "string") return [];
    if (isPlaceholderText(description)) return []; // placeholder rule already fires
    const nameWords = new Set(splitWords(name));
    if (nameWords.size === 0) return [];
    const descWords = splitWords(description).filter((word) => !STOPWORDS.has(word));
    if (descWords.length === 0) return [];
    const novel = descWords.filter((word) => !nameWords.has(word) && !nameWords.has(singular(word)));
    if (novel.length > 0) return [];
    return [{
      path: "/description",
      message: `description ${quote(description)} just restates the name ${quote(name)}`,
      hint: "add what the name cannot carry: inputs, side effects, when to prefer this tool",
    }];
  },
};

/** Words ignored when judging whether a description adds information. */
const STOPWORDS = new Set([
  "a", "an", "the", "this", "that", "to", "of", "for", "and", "or", "in",
  "on", "with", "by", "from", "it", "its", "is", "are", "be", "will",
]);

/** Naive singularization so "files" matches a name word "file". */
function singular(word: string): string {
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("es") && word.length > 3) return word.slice(0, -2);
  if (word.endsWith("s") && word.length > 2) return word.slice(0, -1);
  return word;
}

export const toolDescriptionLong: Rule = {
  id: "tool-description-long",
  category: "description",
  defaultSeverity: "info",
  scope: "tool",
  summary: "Tool description exceeds `maxChars` characters (default 1024).",
  optionDefaults: { maxChars: 1024 },
  checkTool(ctx: ToolContext): RawFinding[] {
    const description = descriptionOf(ctx);
    const maxChars = ctx.options["maxChars"] ?? 1024;
    if (description === undefined || description.length <= maxChars) return [];
    return [{
      path: "/description",
      message: `description is ${description.length} characters — it is sent with every request and crowds out the rest of the prompt`,
      hint: "keep the contract in the description; move examples and caveats into parameter descriptions",
    }];
  },
};

export const duplicateDescription: Rule = {
  id: "duplicate-description",
  category: "description",
  defaultSeverity: "warn",
  scope: "toolset",
  summary: "Two tools share an identical description.",
  checkToolset(ctx: ToolsetContext): RawFinding[] {
    const findings: RawFinding[] = [];
    const seen = new Map<string, number>();
    ctx.tools.forEach((tool, index) => {
      if (typeof tool.description !== "string") return;
      const key = tool.description.trim().replace(/\s+/g, " ").toLowerCase();
      if (key.length === 0) return;
      const firstIndex = seen.get(key);
      if (firstIndex === undefined) {
        seen.set(key, index);
        return;
      }
      findings.push({
        toolIndex: index,
        path: "/description",
        message: `description is identical to ${quote(ctx.names[firstIndex])} (tool #${firstIndex + 1}) — the model cannot tell the two apart`,
        hint: "describe what makes each tool the right choice over the other",
      });
    });
    return findings;
  },
};

export const paramDescriptionMissing: Rule = {
  id: "param-description-missing",
  category: "description",
  defaultSeverity: "warn",
  scope: "tool",
  summary: "A schema property has no description.",
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    for (const node of walkSchema(ctx.tool.inputSchema)) {
      if (node.propertyName === undefined) continue;
      const description = node.schema["description"];
      if (typeof description === "string" && description.trim().length > 0) continue;
      if (isRecord(description)) continue; // wrong type, but not "missing"
      // Combinator branches inherit the parent property's description.
      if (/\/(anyOf|oneOf|allOf)\/\d+$/.test(node.path)) continue;
      findings.push({
        path: node.path,
        message: `parameter "${node.propertyName}" has no description`,
        hint: "say what goes in it, the expected format, and a concrete example value",
      });
    }
    return findings;
  },
};

export const paramDescriptionPlaceholder: Rule = {
  id: "param-description-placeholder",
  category: "description",
  defaultSeverity: "error",
  scope: "tool",
  summary: "A schema property description is placeholder copy.",
  checkTool(ctx: ToolContext): RawFinding[] {
    const findings: RawFinding[] = [];
    for (const node of walkSchema(ctx.tool.inputSchema)) {
      if (node.propertyName === undefined) continue;
      const description = node.schema["description"];
      if (typeof description !== "string" || description.trim().length === 0) continue;
      if (!isPlaceholderText(description)) continue;
      findings.push({
        path: `${node.path}/description`,
        message: `parameter "${node.propertyName}" has placeholder description ${quote(description)}`,
        hint: "the model will read this literally; replace it before shipping the server",
      });
    }
    return findings;
  },
};

export const descriptionRules: Rule[] = [
  toolDescriptionMissing,
  toolDescriptionShort,
  toolDescriptionPlaceholder,
  toolDescriptionRedundant,
  toolDescriptionLong,
  duplicateDescription,
  paramDescriptionMissing,
  paramDescriptionPlaceholder,
];
