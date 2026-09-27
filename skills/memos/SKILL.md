---
name: memos
description: >
  Keeps agent-written comments out of source code by storing them as memos
  in .agents/memos/, one Markdown file per source file (src/a.ts → .agents/memos/src/a.ts.md).
  Use whenever writing, editing, refactoring, renaming, moving or deleting code in a project,
  before adding any code comment, and for `/memos apply` (migrate a project's existing comments
  into memos) or `/memos verify` (check memos against the code).
argument-hint: "[apply | verify]"
---

# Memos

Source files hold code, which humans read. The context an agent would put in comments (why, invariants, and
gotchas) lives in `.agents/memos/<source path>.md` instead. Humans keep a clean source; agents keep
their notes.

The scripts live in `scripts/` next to this file. Run them with Node from the project root, using
this skill's directory: `node <skill-dir>/scripts/verify.mjs`.

## 0. Check the project first.

Look for `.agents/memos/memos.json` in the repository root.

- **Present:** the project is migrated. Obey the rules below.
- **Missing, and the user did not ask for `/memos apply`:** tell the user once, then carry on with
  the project's existing conventions (do not create memos; do not strip comments):

  > The memos skill is enabled, but this project is not migrated yet. Run `/memos apply` to move
  > the existing comments into `.agents/memos/`.

- **The user ran `/memos apply`:** follow [Apply](#apply). Only ever on that explicit request.
- **The user ran `/memos verify`:** run `verify.mjs --changed` and report the result.

## 1. Rules in a migrated project.

1. **Never add comments to source files.** No line comments, block comments, JSX comments, section
   labels, or commented-out code. The context goes in a memo (below) or nowhere.
2. **Existing comments are the author's.** Doc blocks (`/** */`, Python docstrings), directives and
   pragmas (`eslint-disable`, `oxlint-disable`, `@ts-expect-error`, `prettier-ignore`, `# noqa`,
   `# type:`, shebangs, and license headers), and any comment already in the file: do not add, edit, move,
   or delete them. If your change makes one inaccurate, say so in your report. The only exception is
   a directive the code needs to build or lint (for example, `@ts-expect-error` for a known upstream
   typing bug), written the way the project's rules require.
3. **Read before you edit.** Before changing `path/to/file.ts`, read
   `.agents/memos/path/to/file.ts.md` if it exists. Its notes are constraints on your choices.
4. **Write a memo only for what the code cannot say:** why it is done this way, an invariant a
   future edit would break, an upstream quirk, a rejected alternative, a deliberate TODO. Never
   narrate what the code does or restate a signature or log history. Most changes need no memo.
5. **Keep memos true.** A note that is no longer true is worse than none: update or delete it in
   the same change that invalidates it.

## 2. Writing a memo.

````md
---
source: src/models/group.ts
---

## `Group.addMember`

<!-- L42 -->

Members are deduplicated by lowercased email: the SSO provider returns mixed-case addresses.

## `syncGroups`

<!-- L97 · near: `if (remote.version < local.version) {` -->

A stale remote wins on purpose here; local edits are replayed afterwards.
````

- Path: `.agents/memos/` + the repository-relative source path + `.md`. Create the file (and its
  directories) on the first note; `source:` repeats the source path.
- Heading: the symbol, in backticks, qualified by its containers (`Class.method`,
  `Interface.field`, `config.key`; test titles as quoted segments, `"offers"."fires once"`). One
  heading per symbol; add further notes under it. Inside a function body, anchor to the function
  and use `near`, not a local variable.
- Hint: `<!-- L<line> -->` for a note about the symbol itself, `<!-- L<line> · near: `<start of the
  code line>` -->` for a spot inside it. Hints may drift, `verify --fix` corrects them.
- Notes about the whole file go before the first heading.
- Keep the project's tags (`XXX:`, `TODO:`) as they are written.

Full specification, with anchor examples and what does and does not belong in a memo:
[references/format.md](references/format.md).

## 3. Keeping memos in sync.

- **File renamed or moved:** move the memo to the mirrored path and update `source:`.
- **Symbol renamed:** rename its heading. **The symbol moved to another file:** move its section to
  that file's memo.
- **Code deleted:** delete the notes about it, but only after checking the logic was not moved,
  renamed, or refactored somewhere else. If it was, follow it and re-anchor the note.
- **An anchor no longer resolves** (`verify` says *unresolved* or *orphaned*): read the candidates
  it lists (git renames, other files that contain the symbol), find where the code went, and move or
  re-anchor the note. Delete it only when the code is truly gone.

## 4. Before you finish.

Run:

```sh
node <skill-dir>/scripts/verify.mjs --changed --fix
```

It fixes drifted line hints and memos of files Git saw renamed, then reports orphaned memos,
unresolved anchors, and comments added to the source since `HEAD`. Resolve what it reports: move
your own new comments into memos. If a flagged comment was written by the user, leave it alone.

## Apply.

Migrates a project that has comments in its source into memos. Run it only when the user asks
(`/memos apply`).

1. **Preconditions.** The Git working tree must be clean (the script refuses otherwise). Suggest
   doing it on a new branch, e.g. `chore/memos`.
2. **Plan.** Run `node <skill-dir>/scripts/apply.mjs plan`. It prints how many comments would move,
   how many stay (doc blocks, directives, and license headers), and which could not be tied to a symbol.
   Look at the files with the most comments with
   `node <skill-dir>/scripts/apply.mjs plan --show <file>`, which prints the memo that would be
   written and the diff of the source.
   - Generated or vendored code that should not be touched: add `--exclude '<glob>'` (repeatable;
     saved to `memos.json` on run).
   - Comments that must stay in code for this project: add a regular expression to `keep` in
     `.agents/memos/memos.json` (create it with the defaults from `references/format.md` first).
3. **Confirm.** Show the user the summary and a sample, and wait for them to confirm.
4. **Run.** `node <skill-dir>/scripts/apply.mjs run` (accepts the same `--exclude` / `--only` options). It
   writes the memos, removes the comments, and checks each file's code is untouched: a file whose
   tokens would change is skipped and listed. It then writes `memos.json` and adds the rules to
   `AGENTS.md` (or `CLAUDE.md`), between `<!-- memos:start -->` and `<!-- memos:end -->`.
5. **Check.** Run the project's formatter on the source (not on `.agents/memos/`) and its checks
   (lint, type check, tests), as its `AGENTS.md` / `CLAUDE.md` / `package.json` say. Then run
   `verify.mjs --fix`.
6. **Resolve conflicts in the project's rules.** Search the agent instructions (`AGENTS.md`,
   `CLAUDE.md`, `.claude/**`, `.cursor/rules/**`, `.github/copilot-instructions.md`, contribution
   guides) for rules about comments that now contradict memos, for example, "Write `// XXX:` for
   invariants" or "grep for `XXX:` before refactoring". Propose the edits to the user (point them at
   memos, and keep the tags); apply them only after the user agrees. If the project runs a Markdown
   formatter (Prettier, dprint, or a format-on-write hook), also suggest adding `.agents/memos/` to its
   ignore file: memos are verbatim text, and a formatter rewrites it (`*x*` → `_x_`).
7. **Report.** Counts, skipped files, anything left for the user. Do not commit.

Running `apply` again later moves every non-exempt comment it finds, including comments a human has
written since. Use `--only <path>` to limit it.
