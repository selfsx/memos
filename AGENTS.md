# memos — Agent Guide

This repository is the `memos` agent skill, distributed through skills.sh
(`npx skills add selfsx/memos`). `specs/memos.md` holds the original motivation.

## Layout

- `skills/memos/SKILL.md`: the skill itself. Frontmatter `name` and `description` are what
  skills.sh and the agents read; the description decides when the skill triggers.
- `skills/memos/references/format.md`: the memo format specification, loaded on demand.
- `skills/memos/templates/agents-snippet.md`: the always-on rules `apply` installs into a project's
  `AGENTS.md` between `<!-- memos:start -->` and `<!-- memos:end -->`.
- `skills/memos/scripts/`: `apply.mjs` (migration) and `verify.mjs` (checks), sharing `lib/`.
- `test/`: `node --test` suite; `test/fixtures/` are the scanner edge cases.

## Rules

- The scripts ship inside the skill folder and must run with **no dependencies** on Node ≥ 18.
  `typescript` is resolved at runtime from the target project (`lib/typescript.mjs`); the root
  `package.json` has it only for the tests.
- Keep `SKILL.md`, `references/format.md`, `templates/agents-snippet.md` and the scripts in
  agreement. A format change touches all four, plus `test/`.
- `apply` must never change a code token. Every removal path goes through the token comparison in
  `lib/scan.mjs` (`sameJsCode`, `unsafePythonFiles`); a new language needs the same guarantee.
- Every scanner fix gets a fixture case in `test/fixtures/` and an assertion in
  `test/memos.test.mjs`.
- `npm test` must pass before you report done.
