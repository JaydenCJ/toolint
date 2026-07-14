// Unit tests for the text heuristics: word splitting, the lexicons,
// placeholder detection, enum-value vagueness, and edit distance. These
// are the primitives every rule leans on, so edge cases live here.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  editDistance,
  globMatch,
  isActionVerb,
  isAmbiguousParam,
  isGenericName,
  isNegatedBoolean,
  isPlaceholderText,
  isVagueEnumValue,
  normalizeName,
  splitWords,
} from "../dist/index.js";

test("splitWords handles snake, kebab, dots, camel, acronyms, and digits", () => {
  assert.deepEqual(splitWords("get_user_info"), ["get", "user", "info"]);
  assert.deepEqual(splitWords("get-user-info"), ["get", "user", "info"]);
  assert.deepEqual(splitWords("files.read"), ["files", "read"]);
  assert.deepEqual(splitWords("getUserByID"), ["get", "user", "by", "id"]);
  assert.deepEqual(splitWords("HTTPGetRequest"), ["http", "get", "request"]);
  assert.deepEqual(splitWords("delete_file2"), ["delete", "file", "2"]);
});

test("normalizeName collapses case and separators to one comparison key", () => {
  assert.equal(normalizeName("Doc-Search"), "docsearch");
  assert.equal(normalizeName("doc_search"), "docsearch");
  assert.notEqual(normalizeName("doc_search"), normalizeName("doc_fetch"));
});

test("isActionVerb knows common tool verbs and rejects nouns", () => {
  for (const verb of ["get", "list", "create", "delete", "summarize", "validate"]) {
    assert.equal(isActionVerb(verb), true, verb);
  }
  for (const noun of ["user", "ticket", "weather", "doc"]) {
    assert.equal(isActionVerb(noun), false, noun);
  }
});

test("isGenericName flags filler names but accepts real verb_noun names", () => {
  for (const name of ["run", "execute", "do_it", "DoIt", "tool1", "action_2", "handler"]) {
    assert.equal(isGenericName(name), true, name);
  }
  for (const name of ["run_sql_query", "search_notes", "createTicket", "get_weather"]) {
    assert.equal(isGenericName(name), false, name);
  }
});

test("isAmbiguousParam flags catch-all parameter names only", () => {
  for (const name of ["data", "value", "options", "payload", "args"]) {
    assert.equal(isAmbiguousParam(name), true, name);
  }
  for (const name of ["query_text", "user_id", "file_path"]) {
    assert.equal(isAmbiguousParam(name), false, name);
  }
});

test("isNegatedBoolean matches whole leading words, not prefixes of words", () => {
  for (const name of ["no_cache", "not_recursive", "disable_retries", "dont_notify", "disabled"]) {
    assert.equal(isNegatedBoolean(name), true, name);
  }
  // "notes_filter" starts with the letters n-o-t but the word is "notes".
  for (const name of ["notes_filter", "use_cache", "notify_owner", "enabled"]) {
    assert.equal(isNegatedBoolean(name), false, name);
  }
});

test("isPlaceholderText catches short or leading placeholder markers", () => {
  for (const text of ["TODO", "tbd", "TODO: describe this", "(placeholder)", "...", "description goes here", "lorem ipsum dolor sit amet"]) {
    assert.equal(isPlaceholderText(text), true, JSON.stringify(text));
  }
});

test("isPlaceholderText does not flag prose that merely contains a weak token", () => {
  for (const text of [
    "May be empty for a placeholder note that gets filled in later.",
    "Adds a todo item to the user's list and returns its id.",
    "Search issued invoices by customer name or number.",
  ]) {
    assert.equal(isPlaceholderText(text), false, JSON.stringify(text));
  }
});

test("isVagueEnumValue flags slot names and magic values, accepts meaningful ones", () => {
  for (const value of ["option1", "type_a", "MODE-2", "choice_0", "a", "3", ""]) {
    assert.equal(isVagueEnumValue(value), true, JSON.stringify(value));
  }
  for (const value of ["fast_draft", "high_quality", "ascending", "utf8", "gpt-image", "celsius"]) {
    assert.equal(isVagueEnumValue(value), false, value);
  }
});

test("editDistance is exact below the cap and saturates above it", () => {
  assert.equal(editDistance("delete", "delete"), 0);
  assert.equal(editDistance("delete", "deletes"), 1);
  assert.equal(editDistance("create", "delete", 2), 3); // capped at cap + 1
  assert.equal(editDistance("ab", "abcdef", 2), 3); // length gap early exit
});

test("globMatch anchors patterns and only expands *", () => {
  assert.equal(globMatch("legacy_*", "legacy_export"), true);
  assert.equal(globMatch("legacy_*", "not_legacy_export"), false);
  assert.equal(globMatch("a.b", "aXb"), false); // "." is literal, not regex
  assert.equal(globMatch("*", "anything"), true);
});
