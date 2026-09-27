import { spawnSync } from 'node:child_process'
import { leafTokens, parseJs, scanJs } from './scan-js.mjs'
import { pyCommentRanges, scanPy } from './scan-py.mjs'
import { escapeBody } from './memo.mjs'
import { joinCommentLines, lineIndex, nearSnippet } from './text.mjs'
import { requireTypeScript } from './typescript.mjs'

const isPython = (path) => path.endsWith('.py')

export function scanFile(root, path, text, config) {
  const keepRes = (config.keep ?? []).map((s) => new RegExp(s))
  if (isPython(path)) return scanPy(path, text, keepRes)
  return scanJs(requireTypeScript(root), path, text, keepRes)
}

export function anchorOf(entry) {
  return entry.anchor.length ? entry.anchor.join('.') : null
}

export function noteOf(entry, stripped) {
  let line = entry.hintLine
  let near = entry.near
  if (stripped) {
    const idx = stripped.index
    line = idx.lineOf(stripped.map(entry.hintPos)) + 1
    if (entry.nearPos !== null) near = nearSnippet(idx.lineText(idx.lineOf(stripped.map(entry.nearPos))))
  }
  return { hint: { line, near }, body: escapeBody(joinCommentLines(entry.lines)) }
}

export function commentText(entry) {
  return joinCommentLines(entry.lines).replace(/\s+/g, ' ').trim()
}

export function sameJsCode(root, path, before, after) {
  const ts = requireTypeScript(root)
  const a = parseJs(ts, path, before)
  const b = parseJs(ts, path, after)
  if (b.parseDiagnostics.length > a.parseDiagnostics.length) return false
  const ta = leafTokens(ts, a)
  const tb = leafTokens(ts, b)
  return ta.length === tb.length && ta.every((t, i) => t === tb[i])
}

function pyCodeOnly(text) {
  let out = ''
  let last = 0
  for (const r of pyCommentRanges(text)) {
    out += text.slice(last, r.start)
    last = r.end
  }
  out += text.slice(last)
  return out
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
    .join('\n')
}

const PY_CHECK = `
import ast, json, sys
pairs = json.load(sys.stdin)
bad = []
for p in pairs:
    try:
        same = ast.dump(ast.parse(p["before"])) == ast.dump(ast.parse(p["after"]))
    except SyntaxError:
        same = False
    if not same:
        bad.append(p["path"])
print(json.dumps(bad))
`

export function unsafePythonFiles(pairs) {
  if (pairs.length === 0) return []
  const run = spawnSync('python3', ['-c', PY_CHECK], {
    input: JSON.stringify(pairs),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  if (run.status === 0) return JSON.parse(run.stdout)
  return pairs.filter((p) => pyCodeOnly(p.before) !== pyCodeOnly(p.after)).map((p) => p.path)
}

export function withIndex(stripped) {
  return { ...stripped, index: lineIndex(stripped.text) }
}

export { isPython }
