import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { scanJs } from '../skills/memos/scripts/lib/scan-js.mjs'
import { scanPy } from '../skills/memos/scripts/lib/scan-py.mjs'
import { escapeBody, parseMemo, serializeMemo } from '../skills/memos/scripts/lib/memo.mjs'
import { stripComments } from '../skills/memos/scripts/lib/strip.mjs'
import { globToRegExp } from '../skills/memos/scripts/lib/project.mjs'
import { segmentsOf } from '../skills/memos/scripts/lib/anchor.mjs'

const HERE = new URL('.', import.meta.url).pathname
const SCRIPTS = join(HERE, '..', 'skills', 'memos', 'scripts')
const fixture = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8')

const byText = (entries, needle) => entries.find((e) => e.lines.join('\n').includes(needle))

describe('scanJs', () => {
  const text = fixture('sample.ts')
  const entries = scanJs(ts, 'sample.ts', text)

  test('ignores comment-like text in strings, regexes and templates', () => {
    assert.equal(byText(entries, 'not-a-comment'), undefined)
    assert.equal(byText(entries, 'not a comment'), undefined)
    assert.ok(byText(entries, 'inline in template'))
  })

  test('keeps doc blocks, directives, shebang-adjacent license', () => {
    assert.equal(byText(entries, 'Doc block stays').keep, 'doc')
    assert.equal(byText(entries, 'doc on field').keep, 'doc')
    assert.equal(byText(entries, 'oxlint-disable').keep, 'directive')
    assert.equal(byText(entries, 'Copyright').keep, 'license')
  })

  test('groups consecutive line comments and anchors them to the declaration', () => {
    const e = byText(entries, 'indexed from zero')
    assert.deepEqual(e.anchor, ['TIERS'])
    assert.ok(e.exact)
    assert.equal(e.lines.length, 2)
  })

  test('qualifies members with their container', () => {
    assert.deepEqual(byText(entries, 'insertion order').anchor, ['Group', 'members'])
    assert.deepEqual(byText(entries, 'seconds, not ms').anchor, ['Settings', 'timeout'])
  })

  test('comments inside a body anchor to the function with near', () => {
    const e = byText(entries, 'mixed-case')
    assert.deepEqual(e.anchor, ['Group', 'addMember'])
    assert.equal(e.exact, false)
    assert.equal(e.near, 'const key = email.toLowerCase()')
  })

  test('trailing and inline comments are found', () => {
    assert.equal(byText(entries, 'trailing about url').placement, 'trailing')
    assert.equal(byText(entries, 'inline block').placement, 'trailing')
    assert.equal(byText(entries, 'inline in template').placement, 'inline')
  })

  test('rulers are decoration', () => {
    assert.ok(entries.find((e) => e.raw.startsWith('// ----')).decoration)
  })

  test('jsx: text is not a comment, {/* */} is', () => {
    const jsx = scanJs(ts, 'view.tsx', fixture('view.tsx'))
    assert.equal(jsx.length, 1)
    assert.ok(jsx[0].jsx)
    assert.deepEqual(jsx[0].anchor, ['View'])
  })
})

describe('titled calls', () => {
  const entries = scanJs(ts, 'offers.test.ts', fixture('offers.test.ts'))

  test('describe/it titles become quoted segments', () => {
    const exact = byText(entries, 'wallet starts empty')
    assert.deepEqual(exact.anchor, ['"offers"', '"fires once per turn"'])
    assert.ok(exact.exact)
    const inBody = byText(entries, 'must not fire')
    assert.deepEqual(inBody.anchor, ['"offers"', '"fires once per turn"'])
    assert.equal(inBody.near, 'expect(turn).toBe(1)')
  })

  test('segmentsOf splits outside quotes', () => {
    assert.deepEqual(segmentsOf('"a.b"."c".d'), ['"a.b"', '"c"', 'd'])
    assert.deepEqual(segmentsOf('Group.addMember'), ['Group', 'addMember'])
  })
})

describe('scanPy', () => {
  const entries = scanPy('tool.py', fixture('tool.py'))

  test('strings and docstrings are not comments', () => {
    assert.equal(byText(entries, 'not a comment'), undefined)
  })

  test('shebang, coding and type pragmas are kept', () => {
    assert.equal(byText(entries, 'python3').keep, 'shebang')
    assert.equal(byText(entries, 'coding').keep, 'directive')
    assert.equal(byText(entries, 'type: ignore').keep, 'directive')
  })

  test('anchors by indentation', () => {
    assert.deepEqual(byText(entries, 'lowercase path').anchor, ['Store', 'cache'])
    const inBody = byText(entries, 'normalise first')
    assert.deepEqual(inBody.anchor, ['Store', 'load'])
    assert.equal(inBody.exact, false)
    assert.deepEqual(byText(entries, 'trailing limit').anchor, ['LIMIT'])
  })
})

describe('stripComments', () => {
  test('removes own-line comments and collapses the blank line they leave', () => {
    const text = 'a()\n\n// x\n\nb()\n'
    const entries = scanJs(ts, 'a.ts', text)
    assert.equal(stripComments(text, entries).text, 'a()\n\nb()\n')
  })

  test('removes trailing comments with their whitespace', () => {
    const text = 'a() // x\n'
    assert.equal(stripComments(text, scanJs(ts, 'a.ts', text)).text, 'a()\n')
  })

  test('maps offsets into the stripped text', () => {
    const text = '// x\nconst a = 1\n'
    const { text: out, map } = stripComments(text, scanJs(ts, 'a.ts', text))
    assert.equal(out.slice(map(text.indexOf('const'))), 'const a = 1\n')
  })
})

describe('memo format', () => {
  test('round-trips', () => {
    const src = [
      '---',
      'source: src/a.ts',
      '---',
      '',
      'File note.',
      '',
      '## `A.b`',
      '<!-- L3 -->',
      'one',
      '',
      '<!-- L9 · near: `x()` -->',
      'two',
      '',
      '```',
      '## not a heading',
      '```',
      '',
    ].join('\n')
    const memo = parseMemo(src)
    assert.equal(memo.source, 'src/a.ts')
    assert.equal(memo.sections[1].anchor, 'A.b')
    assert.equal(memo.sections[1].notes[1].hint.near, 'x()')
    assert.ok(memo.sections[1].notes[1].body.includes('## not a heading'))
    assert.equal(serializeMemo(parseMemo(serializeMemo(memo))), serializeMemo(memo))
  })
})

test('escapeBody fences preformatted text and escapes headings', () => {
  const body = escapeBody('Run it:\n  npm run a   # dry\n  npm run b\nthen\n## not a heading\n- item\n  continued')
  assert.equal(
    body,
    'Run it:\n\n```\nnpm run a   # dry\nnpm run b\n```\n\nthen\n\\## not a heading\n- item\n  continued',
  )
})

test('globToRegExp', () => {
  assert.ok(globToRegExp('**/node_modules/**').test('a/node_modules/b.js'))
  assert.ok(globToRegExp('**/node_modules/**').test('node_modules/b.js'))
  assert.ok(globToRegExp('apps/*/drizzle/**').test('apps/api/drizzle/0001.ts'))
  assert.ok(globToRegExp('**/*.{js,ts}').test('x/y.ts'))
  assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'))
})

describe('apply + verify end to end', () => {
  let dir
  const node = (script, ...args) =>
    spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { cwd: dir, encoding: 'utf8' })
  const sh = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'memos-e2e-'))
    cpSync(join(HERE, 'fixtures'), dir, { recursive: true })
    symlinkSync(join(HERE, '..', 'node_modules'), join(dir, 'node_modules'))
    writeFileSync(join(dir, '.gitignore'), 'node_modules\n')
    sh('init', '-q')
    sh('add', '-A')
    sh('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  test('verify warns before migration', () => {
    const r = node('verify.mjs')
    assert.equal(r.status, 1)
    assert.match(r.stdout, /not migrated/)
  })

  test('apply run migrates, keeps code tokens, installs rules', () => {
    const r = node('apply.mjs', 'run')
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.ok(existsSync(join(dir, '.agents/memos/memos.json')))
    assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /memos:start/)
    const src = readFileSync(join(dir, 'sample.ts'), 'utf8')
    assert.ok(!src.includes('XXX'))
    assert.ok(src.includes('Doc block stays'))
    assert.ok(src.includes('oxlint-disable'))
    assert.ok(!readFileSync(join(dir, 'view.tsx'), 'utf8').includes('{/*'))
  })

  test('hints point at the stripped source, verify is clean', () => {
    const r = node('verify.mjs')
    assert.equal(r.status, 0, r.stdout)
    assert.doesNotMatch(r.stdout, /stale/)
    const memo = readFileSync(join(dir, '.agents/memos/sample.ts.md'), 'utf8')
    const line = Number(memo.match(/## `TIERS`\n\n<!-- L(\d+)/)[1])
    assert.match(readFileSync(join(dir, 'sample.ts'), 'utf8').split('\n')[line - 1], /TIERS/)
  })

  test('verify --changed flags new comments', () => {
    sh('add', '-A')
    sh('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'memos')
    writeFileSync(join(dir, 'sample.ts'), readFileSync(join(dir, 'sample.ts'), 'utf8') + '\n// agent narration\n')
    const r = node('verify.mjs', '--changed')
    assert.equal(r.status, 1)
    assert.match(r.stdout, /agent narration/)
    sh('checkout', '-q', 'sample.ts')
  })

  test('verify reports renamed symbols and --fix follows renamed files', () => {
    const src = readFileSync(join(dir, 'sample.ts'), 'utf8')
    writeFileSync(join(dir, 'sample.ts'), src.replace('timeout', 'timeoutSeconds'))
    let r = node('verify.mjs')
    assert.equal(r.status, 1)
    assert.match(r.stdout, /unresolved .*Settings\.timeout/)
    sh('checkout', '-q', 'sample.ts')

    sh('mv', 'sample.ts', 'renamed.ts')
    r = node('verify.mjs', '--fix')
    assert.equal(r.status, 0, r.stdout)
    assert.match(r.stdout, /moved .*renamed\.ts\.md/)
    assert.ok(existsSync(join(dir, '.agents/memos/renamed.ts.md')))
    assert.match(readFileSync(join(dir, '.agents/memos/renamed.ts.md'), 'utf8'), /source: renamed\.ts/)
  })
})
