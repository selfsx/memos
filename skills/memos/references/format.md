# Memo format

## Location

One memo per source file, only for files that have something worth recording:

```
src/models/group.ts   →   .agents/memos/src/models/group.ts.md
```

The path is the source path relative to the repository root, plus `.md`. No empty memos, no
directory-level memos.

`.agents/memos/memos.json` marks the project as migrated and configures the scripts:

```json
{
  "version": 1,
  "extensions": [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".py"],
  "exclude": ["**/node_modules/**", "**/dist/**", "..."],
  "keep": []
}
```

`keep` is a list of regular expressions; a comment matching one is treated like a directive and
never moved.

## File

````md
---
source: src/models/group.ts
---

Notes about the whole file go here, before the first heading.

## `Group.addMember`

<!-- L42 -->

Members are deduplicated by lowercased email: the SSO provider returns mixed-case addresses.

## `Group.members`

<!-- L18 -->

Order matters, the invite screen relies on insertion order.

## `syncGroups`

<!-- L97 · near: `if (remote.version < local.version) {` -->

XXX: a stale remote wins on purpose here. Local edits are replayed afterwards.

<!-- L130 · near: `await queue.flush()` -->

Flushing before the lock is released avoids a double send when two workers overlap.
````

Headings, hints, and bodies are separated by blank lines (canonical Markdown).

### Frontmatter

`source:` is the repository-relative source path. It must match the memo's own path; `verify`
reports a memo whose path and `source` disagree.

### Anchors

A `##` heading names the symbol a note is about, in backticks, qualified by its containers:


| Code                                    | Anchor                  |
| --------------------------------------- | ----------------------- |
| `export function syncGroups()`          | `syncGroups`            |
| method `addMember` in `class Group`     | `Group.addMember`       |
| field `members` in `interface Group`    | `Group.members`         |
| `constructor` in `class Group`          | `Group.constructor`     |
| key `retry` in `const config = { … }`   | `config.retry`          |
| `export default function () {}`         | `default`               |
| `def load()` in `class Store` (Python)  | `Store.load`            |
| `it('fires once', …)` in `describe('offers', …)` | `"offers"."fires once"` |
| `app.get('/health', handler)`           | `"/health"`             |


A call whose first argument is a string and which takes a callback (`describe`, `it`, `test`, route
handlers, commands) is a container too: its title becomes a quoted segment. Inside a function body,
the anchor stops at the function; point at the spot with `near` instead of anchoring to a local.

Anchors resolve by name, not by position, so they survive edits elsewhere in the file. `verify`
checks that every segment of an anchor still appears in the source.

One heading per symbol. Several notes about the same symbol sit under the same heading, each with
its hint.

### Hints

The HTML comment under a heading (or before a note) is a hint, invisible when rendered:

- `<!-- L42 -->`: the line the note is about;
- `<!-- L97 · near: `code` -->`: the note is about a spot inside the symbol, not the symbol itself;
  `near` is the start of that line of code (at most 80 characters, backticks replaced by `'`).

Hints help to jump to the spot; they are allowed to drift. `verify --fix` rewrites them. Never rely
on a hint over the anchor.

### Note bodies

Plain Markdown. Keep the wording of any tag the project uses (`XXX:`, `TODO:`, `HACK:`) so greps
keep working. A body line that would start a heading or look like a hint is escaped with `\`.
Preformatted text (indented or column-aligned lines, commands, and tables) goes in a code fence so it
survives rendering.

Memos hold text verbatim, so keep Markdown formatters (Prettier, dprint) away from them: add
`.agents/memos/` to the formatter's ignore file. A formatter would, for example, turn a literal
`*asterisks*` example into `_asterisks_`.

## What belongs in a memo?

Write a note only if a competent engineer, reading this code later, would need it **and** could not
get it from the code, its names, its types, or its tests:

- why it is done this way, when the obvious way is wrong ("the SSO provider returns mixed-case
  emails")
- an invariant a future edit would silently break ("affinity only ever increases; a wrong award
  cannot be corrected in place")
- upstream contracts, platform or driver quirks, measured results behind a magic number
- a decision and the alternative that was rejected, when someone will be tempted to redo it
- a deliberate TODO with the condition that unblocks it

Do not write:

- what the code does (`increments the counter`, `validate input`, `now we save`)
- section labels, restated signatures, explanations of language features
- change history ("changed from X to Y"), which belongs in the commit message
- anything already in `AGENTS.md`, the specs or a doc block

If nothing qualifies, write nothing. No memo file is the normal state for most files.

## Keeping memos in sync.


| You did                         | Do this to the memo                                              |
| ------------------------------- | ---------------------------------------------------------------- |
| renamed or moved a file         | move the memo to the new mirrored path, update `source:`         |
| deleted a file                  | delete its memo, after checking the code was not moved elsewhere |
| renamed a symbol                | rename the heading                                               |
| moved a symbol to another file  | move its section to the other file's memo, fix the anchor        |
| deleted a symbol                | delete its section, unless the logic survived under a new name   |
| changed behaviour a note covers | update or delete the note, so it never states something false    |


When `verify` reports an orphaned memo or an unresolved anchor, do not just delete it. Look at its
suggestions (git renames, other files containing the anchor), read the candidates, and follow the
code to where it went. Delete only when the code is truly gone.
