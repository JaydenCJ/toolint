# toolint rule reference

Every rule, its default severity, and the model-usability reasoning behind it.
Severities: **error** fails the lint (exit 1), **warn** is reported but passing,
**info** is advisory. All defaults can be changed per rule in
`toolint.config.json` — see [Configuration](#configuration) at the bottom.

toolint's rules encode one idea from several angles: *the model only sees the
name, the description, and the schema.* Anything those three don't carry, the
model will guess — and a guess that validates against the schema is the worst
kind, because nothing downstream catches it.

## naming

Models pick which tool to call by name first, so naming problems cause
wrong-tool calls, not just ugly catalogs.

| Rule | Default | Fires when | Why it confuses models |
|---|---|---|---|
| `name-format` | error | the name is missing, empty, or uses characters outside `A-Za-z0-9_.-` | many clients reject such names outright; the tool silently vanishes from the catalog |
| `name-length` | warn | the name exceeds `max` characters (default 64) | long names burn context on every request and get truncated in some clients |
| `name-casing` | warn | one identifier mixes snake_case and camelCase (`get_userInfo`) | models reproduce inconsistent names inconsistently, causing unknown-tool errors |
| `name-verb` | warn | the leading word is not an action verb (`user_delete`, `weather`) | the leading verb is the strongest signal for tool selection; noun-first names get skipped or misused |
| `name-generic` | error | the whole name is filler: `run`, `execute`, `handler`, `tool1`, `do_it` | a generic name gives the model nothing to match an intent against |
| `name-collision` | error | two names collapse to one identifier after case/separator folding (`DocSearch` vs `doc_search`) | models treat these as the same tool and pick one at random |
| `name-similar` | warn | two names are the same words reordered (`file_delete` / `delete_file`) or one edit apart (`get_user` / `get_users`) | near-duplicates split usage between two tools unpredictably |

## description

The description is the only channel that says *when* to call a tool and what
each argument means.

| Rule | Default | Fires when | Why it confuses models |
|---|---|---|---|
| `tool-description-missing` | error | there is no description at all | the model can only guess from the name when to call the tool |
| `tool-description-short` | warn | fewer than `minWords` words (default 4) | a two-word description cannot disambiguate against neighboring tools |
| `tool-description-placeholder` | error | TODO/TBD/`description here`-style copy | the model reads placeholder text literally |
| `tool-description-redundant` | warn | the description only restates the name (`get_user` → "Gets the user") | zero added information; the model still knows nothing about inputs, side effects, or when to prefer this tool |
| `tool-description-long` | info | more than `maxChars` characters (default 1024) | tool descriptions are sent with every request; prompt bloat crowds out the task |
| `duplicate-description` | warn | two tools share an identical description | the model cannot tell the two apart at selection time |
| `param-description-missing` | warn | a schema property (at any depth) has no description | the model invents the argument's meaning, format, and units |
| `param-description-placeholder` | error | a property description is placeholder copy | same as the tool-level rule, one level down |

## schema

Structural properties that decide whether the model can fill in arguments
reliably.

| Rule | Default | Fires when | Why it confuses models |
|---|---|---|---|
| `schema-missing` | error | there is no `inputSchema` object | neither clients nor models know what arguments exist |
| `schema-root-type` | error | the root schema is not `"type": "object"` | tool arguments are always a JSON object; anything else breaks clients |
| `param-type-missing` | warn | a property has no `type`, `enum`, `const`, `$ref`, or combinator | the model improvises a type, and validation cannot reject bad calls |
| `free-form-object` | warn | an object property declares no `properties` (and no typed `additionalProperties`) | the model must invent key names; a typed map or explicit keys fix this |
| `array-missing-items` | warn | an array property has no `items`/`prefixItems` | the model guesses the element shape |
| `required-undeclared` | error | `required` lists a property not in `properties` | the model is told a parameter is mandatory but given no schema for it |
| `too-many-params` | warn | more than `max` top-level parameters (default 10) | argument accuracy degrades as the surface grows; split by use case |
| `deep-nesting` | warn | properties nested deeper than `max` levels (default 3) | models frequently misplace deeply nested keys; flat schemas are called correctly more often |
| `param-name-ambiguous` | warn | a catch-all name (`data`, `value`, `options`, `payload`) with no real description | the name invites guessing; a precise description redeems it |
| `boolean-negated` | warn | a boolean phrased as a negation (`no_cache`, `disable_retries`) | `"no_cache": false` is a double negative; models get the polarity wrong |
| `default-mismatch` | error | a `default` outside its own enum, or of the wrong type | models copy defaults into calls; a broken default guarantees invalid arguments |
| `union-overload` | warn | a root-level `anyOf`/`oneOf`, or a property union with more than `maxBranches` branches (default 3) | variant calling conventions force the model to pick a shape before it picks arguments |

## enum

Enums are the strongest steering signal a schema can give — when the values
mean something.

| Rule | Default | Fires when | Why it confuses models |
|---|---|---|---|
| `enum-empty` | error | `"enum": []` | no value can ever validate |
| `enum-single` | info | exactly one value | it is a constant, not a choice; use `const` or fill it server-side |
| `enum-duplicate` | error | repeated values, or case-only variants (`pdf` / `PDF`) | the model must coin-flip between spellings |
| `enum-vague` | warn | slot names (`option1`, `type_a`), single letters, or numeric strings (`"3"`) | multiple choice with the answers redacted |
| `enum-mixed-types` | warn | strings and numbers in one enum | models routinely send `"3"` for `3` and vice versa |
| `enum-inconsistent-case` | warn | values mixing case or separator conventions | models normalize toward one style and miss the odd ones out |
| `enum-large` | info | more than `max` values (default 24) | every value is sent with every request; consider a free string plus server-side validation |

## Paths

Findings point into the tool with a JSON-pointer-like path, e.g.
`/inputSchema/properties/mode/enum` or `/name`. Property names containing
`/` or `~` are escaped per RFC 6901. Combinator branches append
`/anyOf/0`-style segments.

## Configuration

`toolint.config.json` (nearest one above the working directory, or
`--config <file>`):

```json
{
  "rules": {
    "enum-large": "off",
    "name-verb": "info",
    "too-many-params": { "severity": "error", "options": { "max": 6 } }
  },
  "ignoreTools": ["legacy_*", "debug_*"]
}
```

- A rule maps to a severity string (`off`, `info`, `warn`, `error`) or an
  object with `severity` and/or `options`.
- Option keys are validated against the rule's option table above; unknown
  rule ids and option names are hard errors so typos cannot silently
  un-disable a rule.
- `ignoreTools` skips matching tools entirely (only `*` wildcards).
