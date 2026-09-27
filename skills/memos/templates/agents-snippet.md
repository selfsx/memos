<!-- memos:start -->
## Code comments live in memos.

This project keeps agent-written notes out of the source. The context a comment would carry lives in
`.agents/memos/<path>.md`, mirroring the source tree (`src/models/group.ts` →
`.agents/memos/src/models/group.ts.md`). The `memos` skill has the full rules and the scripts.

- **Never add comments to source files.** Put the note in the file's memo instead, under a
  `` ## `Symbol` `` heading. Record only what the code cannot say (why, invariants, gotchas, and
  upstream quirks); never narrate what the code does.
- **Existing comments belong to the author.** Doc blocks (`/** */`, docstrings), directives
  (`eslint-disable`, `@ts-expect-error`, `# noqa`, …), and any comment already in the source are left
  exactly as they are: do not add, edit, move, or delete them. If your change makes one wrong, say so
  in your report.
- **Before editing a file, read its memo** if one exists.
- **Keep memos in sync.** Move or rename the memo with its file; rename a heading with its symbol.
  When an anchor no longer resolves, first check whether the code was moved, renamed, or refactored
  and follow it; delete a note only when its code is really gone.
- **Before finishing**, run the skill's `scripts/verify.mjs --changed --fix` (`/memos verify`) and
  resolve what it reports.
<!-- memos:end -->
