/**
 * Text heuristics shared by the rules: word splitting for snake/camel/kebab
 * identifiers, the action-verb lexicon, generic-name and ambiguous-parameter
 * word lists, placeholder detection, case-style classification, and a small
 * Levenshtein for near-duplicate names.
 *
 * Everything in this module is pure and deterministic — data in, data out.
 */

/**
 * Action verbs a well-named tool starts with. A model choosing between
 * tools reads the leading verb first; names that lead with one are picked
 * correctly far more often than noun-first or bare-adjective names.
 */
const ACTION_VERBS = new Set([
  // read-ish
  "get", "list", "search", "find", "query", "fetch", "read", "load", "lookup",
  "describe", "show", "view", "preview", "inspect", "browse", "peek", "poll",
  // create-ish
  "create", "add", "insert", "post", "write", "make", "new", "register",
  "generate", "compose", "draft", "record", "save", "put", "append", "clone",
  // update-ish
  "update", "edit", "set", "modify", "patch", "rename", "move", "copy",
  "replace", "assign", "reorder", "adjust", "configure", "reset", "restore",
  "apply", "revert", "undo", "redo", "mark", "tag", "label", "pin", "sort",
  // delete-ish
  "delete", "remove", "purge", "clear", "drop", "archive", "unlink", "erase",
  // execute-ish
  "run", "execute", "start", "stop", "restart", "pause", "resume", "cancel",
  "kill", "invoke", "trigger", "launch", "deploy", "build", "install",
  "schedule", "retry", "submit", "dispatch", "spawn", "abort", "wait",
  // transfer-ish
  "send", "notify", "publish", "subscribe", "unsubscribe", "upload",
  "download", "export", "import", "sync", "push", "pull", "share", "forward",
  "broadcast", "stream", "emit",
  // transform-ish
  "convert", "render", "transform", "translate", "parse", "format", "encode",
  "decode", "encrypt", "decrypt", "sign", "hash", "compress", "decompress",
  "extract", "merge", "split", "filter", "group", "aggregate", "normalize",
  "resize", "crop", "rotate", "trim", "redact", "summarize", "expand",
  // verify-ish
  "validate", "verify", "check", "lint", "test", "analyze", "compare",
  "diff", "count", "compute", "calculate", "measure", "estimate", "score",
  "rank", "evaluate", "audit", "scan", "detect", "classify", "resolve",
  // session-ish
  "open", "close", "connect", "disconnect", "login", "logout", "lock",
  "unlock", "grant", "revoke", "approve", "reject", "accept", "deny",
  "enable", "disable", "toggle", "mute", "unmute", "watch", "unwatch",
  "monitor", "track", "ping", "refresh", "reload", "flush",
  // commerce-ish
  "book", "reserve", "order", "buy", "sell", "pay", "charge", "refund",
  "quote", "invoice", "bill", "confirm",
]);

/**
 * Names that tell the model nothing about what calling the tool does.
 * Compared against the *whole* normalized name, not individual words.
 */
const GENERIC_NAMES = new Set([
  "run", "execute", "exec", "do", "doit", "process", "handle", "handler",
  "action", "act", "perform", "tool", "function", "func", "fn", "main",
  "call", "invoke", "task", "command", "cmd", "go", "api", "request",
  "operation", "op", "utility", "util", "helper", "work", "job", "thing",
  "stuff", "misc", "generic", "general", "default", "start", "submit",
  "foo", "bar", "baz", "temp", "tmp", "test", "demo", "sample", "custom",
]);

/** Matches numbered filler names like `tool1`, `action_2`, `fn-3`. */
const NUMBERED_GENERIC = /^(tool|action|task|function|func|fn|command|cmd|op|operation|step|handler|method)[_-]?\d+$/;

/**
 * Parameter names that force the model to guess what to put in them
 * unless the description spells it out.
 */
const AMBIGUOUS_PARAMS = new Set([
  "data", "value", "val", "input", "output", "obj", "object", "options",
  "opts", "params", "parameters", "args", "arg", "arguments", "info",
  "payload", "item", "thing", "stuff", "misc", "var", "tmp", "temp",
  "str", "num", "flag", "field", "x", "config", "settings", "extra",
  "metadata", "meta", "props", "body", "request", "context",
]);

/** Prefixes that make a boolean read as a negation (`no_cache: false`). */
const NEGATED_PREFIXES = ["no", "not", "dont", "never", "disable", "disallow", "skip"];

/**
 * Placeholder detection is two-tier. Strong phrases are unambiguous and
 * match anywhere; weak tokens (a real sentence may legitimately contain
 * "todo" or "placeholder") only count when the text is very short or
 * leads with them.
 */
const STRONG_PLACEHOLDER_RE =
  /\b(lorem ipsum|fill (me|this) in|coming soon|to be (written|added|filled)|description (here|goes here)|add (a )?description|no description( yet)?|insert description)\b/i;
const WEAK_PLACEHOLDER_RE = /\b(todo|tbd|fixme|wip|xxx|placeholder|changeme|n\/a)\b/i;
const LEADING_WEAK_RE = /^[\s([{<*_-]*(todo|tbd|fixme|wip|xxx|placeholder|changeme)\b/i;

/** Enum values that name a slot, not a meaning: `option1`, `type_a`, `mode-2`. */
const VAGUE_ENUM_RE =
  /^(option|opt|type|mode|value|val|item|choice|variant|case|enum|kind|style|state|status|level|flag)[_-]?([0-9]+|[a-z])$/i;

/**
 * Split an identifier into lowercase words. Handles snake_case, kebab-case,
 * camelCase, PascalCase, dotted names, digit boundaries, and any mix.
 *
 *   splitWords("getUserByID") -> ["get", "user", "by", "id"]
 *   splitWords("delete_file2") -> ["delete", "file", "2"]
 */
export function splitWords(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-zA-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

/** Lowercase and strip every non-alphanumeric character. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when the word is in the action-verb lexicon. */
export function isActionVerb(word: string): boolean {
  return ACTION_VERBS.has(word);
}

/** True when the whole name is generic filler (`run`, `do_it`, `tool2`). */
export function isGenericName(name: string): boolean {
  const joined = splitWords(name).join("");
  const spaced = splitWords(name).join("_");
  return GENERIC_NAMES.has(joined) || NUMBERED_GENERIC.test(spaced) || NUMBERED_GENERIC.test(joined);
}

/** True when the parameter name is on the guess-inviting list. */
export function isAmbiguousParam(name: string): boolean {
  return AMBIGUOUS_PARAMS.has(name.toLowerCase());
}

/** True when a boolean parameter name reads as a negation. */
export function isNegatedBoolean(name: string): boolean {
  const words = splitWords(name);
  const first = words[0];
  if (first === undefined) return false;
  if (NEGATED_PREFIXES.includes(first)) return true;
  return words.length === 1 && (first === "disabled" || first === "off" || first === "hidden");
}

/** True when the text looks like unfinished placeholder copy. */
export function isPlaceholderText(text: string): boolean {
  const trimmed = text.trim();
  if (/^[.\-_?*#]+$/.test(trimmed)) return true;
  if (STRONG_PLACEHOLDER_RE.test(trimmed)) return true;
  if (LEADING_WEAK_RE.test(trimmed)) return true;
  return wordCount(trimmed) <= 4 && WEAK_PLACEHOLDER_RE.test(trimmed);
}

/** True when an enum value names a slot rather than a meaning. */
export function isVagueEnumValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  if (/^\d+$/.test(trimmed)) return true; // magic number as a string
  if (/^[a-zA-Z]$/.test(trimmed)) return true; // single letter
  return VAGUE_ENUM_RE.test(trimmed);
}

/** Case-style facts about one enum value, used for consistency checks. */
export interface CaseProfile {
  hasUpper: boolean;
  allLower: boolean;
  usesUnderscore: boolean;
  usesHyphen: boolean;
}

/** Classify one string's case/separator style. */
export function caseProfile(value: string): CaseProfile {
  return {
    hasUpper: /[A-Z]/.test(value),
    allLower: /[a-z]/.test(value) && !/[A-Z]/.test(value),
    usesUnderscore: value.includes("_"),
    usesHyphen: value.includes("-"),
  };
}

/**
 * Levenshtein edit distance with an early-exit cap. Returns `cap + 1`
 * as soon as the distance provably exceeds `cap`.
 */
export function editDistance(a: string, b: string, cap = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = (current[j - 1] as number) + 1;
      const deletion = (previous[j] as number) + 1;
      const cost = Math.min(substitution, insertion, deletion);
      current.push(cost);
      if (cost < rowMin) rowMin = cost;
    }
    if (rowMin > cap) return cap + 1;
    previous = current;
  }
  return previous[b.length] as number;
}

/** Number of whitespace-separated words in free text. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** Quote a value for messages, keeping output single-line and short. */
export function quote(value: unknown): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const flat = String(raw).replace(/\s+/g, " ");
  return `"${flat.length > 48 ? `${flat.slice(0, 45)}...` : flat}"`;
}

/** Simple `*`-only glob match, anchored at both ends. Case-sensitive. */
export function globMatch(pattern: string, value: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(value);
}
