# memos

🤖️ Structure your code for agents and for humans.

Coding agents fill source files with comments: half of an average agent's output is notes to itself.
They carry useful context, but they bury the code a human has to read.

**memos** is an agent skill that moves those notes out of the source. The agent writes no comments;
what it would have said goes to a Markdown memo that mirrors the file:

```
src/models/group.ts   →   .agents/memos/src/models/group.ts.md
```

```md
---
source: src/models/group.ts
---

## `Group.addMember`

<!-- L42 -->

Members are deduplicated by lowercased email: the SSO provider returns mixed-case addresses.
```

Notes are anchored to symbols, not line numbers, so they survive edits. The agent reads a file's memo
before changing it and keeps it in sync when code is renamed, moved or deleted. Doc blocks,
directives (`eslint-disable`, `@ts-expect-error`, `# noqa`) and comments written by humans stay in
the code, untouched.

## Install

With [skills.sh](https://skills.sh):

```sh
npx skills add selfsx/memos
```

Then, in your project, migrate the comments that are already there:

```
/memos apply
```

`apply` shows a plan first (what moves, what stays, what could not be anchored), then writes the
memos, strips the comments, checks that no code token changed, and adds the always-on rules to
`AGENTS.md`. Until a project is migrated, the skill only warns and leaves it alone.

## Commands

| Command         | Script                                    | What it does                                                        |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| `/memos apply`  | `scripts/apply.mjs plan` / `run`          | migrate existing comments into memos                                |
| `/memos verify` | `scripts/verify.mjs [--changed] [--fix]`  | orphaned memos, unresolved anchors, stale hints, new comments in diff |

Both scripts are plain Node (≥ 18), with no dependencies. JS/TS files are parsed with the project's
own `typescript` package, so JSX, template literals and regexes are handled exactly. Python is
supported too.

## Layout

```
skills/memos/
  SKILL.md                     the skill
  references/format.md         memo format specification
  templates/agents-snippet.md  rules installed into AGENTS.md
  scripts/apply.mjs            migration
  scripts/verify.mjs           consistency checks
test/                          node --test suite and fixtures
specs/                         design notes
```

## Development

```sh
npm install
npm test
```
