# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- 34 lint rules encoding model-usability heuristics for tool JSON Schemas,
  in four categories:
  - **naming** (7): format/length/casing checks, verb-first enforcement,
    generic-filler detection (`run`, `tool1`), cross-tool collision and
    near-duplicate detection (case/separator folding, reordered words,
    one-edit neighbors).
  - **description** (8): missing/short/placeholder/redundant tool
    descriptions, oversized descriptions, cross-tool duplicates, and
    missing/placeholder parameter descriptions at any schema depth.
  - **schema** (12): missing schemas, non-object roots, untyped parameters,
    free-form objects, itemless arrays, phantom `required` entries,
    parameter-count and nesting-depth thresholds, catch-all parameter
    names, negated booleans, defaults that violate their own enum/type,
    and union overload.
  - **enum** (7): empty/singleton/duplicate enums, case-only variants,
    vague slot-name values (`option1`, `"3"`), mixed JSON types, mixed
    case conventions, and oversized enums.
- Input parsing for every shape tool catalogs travel in: bare arrays,
  MCP `tools/list` results, raw JSON-RPC responses, single tool objects,
  and OpenAI-style `parameters` / `{"type": "function"}` wrappers plus
  `input_schema` aliases.
- A schema walker that visits nested properties, array items, typed maps,
  and `anyOf`/`oneOf`/`allOf` branches, reporting findings with
  RFC 6901-escaped JSON-pointer paths.
- The `toolint` CLI: multiple files or `--stdin`, `pretty` / `compact` /
  `json` output, `--rules` reference listing, `--quiet`, `--max-warnings`,
  and a CI-friendly exit contract (0 clean / 1 findings / 2 usage error).
- `toolint.config.json` with upward discovery and `--config` / `--no-config`
  overrides: per-rule severities (`off`/`info`/`warn`/`error`), numeric rule
  options, and `ignoreTools` glob patterns — all strictly validated so a
  typo cannot silently un-disable a rule.
- Every finding carries an actionable fix hint alongside the message.
- Public programmatic API (`lintTools`, `parseToolsJson`, `resolveConfig`,
  formatters, the rule registry, walker, and text heuristics) with type
  declarations.
- A clean and a messy example server catalog plus a sample config under
  `examples/`, a full rule reference in `docs/rules.md`, and trilingual
  READMEs (en/zh/ja).
- Test suite: 91 node:test tests (text heuristics, walker, all four rule
  families, engine, config, parsing, formatters, real CLI child-process
  runs) and an end-to-end `scripts/smoke.sh`.

[0.1.0]: https://github.com/JaydenCJ/toolint/releases/tag/v0.1.0
