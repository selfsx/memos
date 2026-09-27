#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseMemo, serializeMemo } from './lib/memo.mjs'
import {
  CONFIG_FILE,
  MEMOS_DIR,
  findRoot,
  git,
  loadConfig,
  memoPathFor,
  parseArgs,
  sourceFiles,
  trackedFiles,
} from './lib/project.mjs'
import { commentText, scanFile } from './lib/scan.mjs'
import { isQuoted, segmentsOf, unquote } from './lib/anchor.mjs'

const USAGE = `usage: verify.mjs [options]

  checks every memo in ${MEMOS_DIR}/ against the source:
    orphaned memos (source file gone; suggests where it moved)
    unresolved anchors (symbol not found; suggests where it went)
    stale line hints

  --changed   also flag comments added to source files in the working tree (vs HEAD)
  --fix       rewrite stale line hints and move memos whose source was renamed
  --root      project root (default: git top level of cwd)`

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wordRe = (w) => new RegExp(`(?<![\\w$#])${escapeRe(w)}(?![\\w$])`)
const norm = (s) => s.replace(/\s+/g, ' ').replace(/`/g, "'").trim()

function segmentFound(text, segment) {
  if (isQuoted(segment)) return text.replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').includes(unquote(segment))
  if (segment === 'default') return /export\s+default\b/.test(text)
  return wordRe(segment).test(text)
}

function declRe(leaf) {
  const w = escapeRe(leaf)
  return new RegExp(
    `(?:\\b(?:function\\*?|class|interface|type|enum|namespace|module|const|let|var|def|get|set)\\s+${w}(?![\\w$])|^\\s*(?:(?:export|default|async|static|readonly|private|public|protected|override|abstract|declare|accessor)\\s+)*['"]?${w}['"]?\\s*[?!]?\\s*[:(=<])`,
  )
}

function locate(lines, anchor, hint) {
  let candidates = []
  if (hint.near) {
    const near = norm(hint.near.replace(/\.\.\.$/, ''))
    candidates = lines.flatMap((l, i) => (norm(l).includes(near) ? [i + 1] : []))
  }
  if (!candidates.length && anchor) {
    const leaf = segmentsOf(anchor).at(-1)
    if (isQuoted(leaf)) {
      const title = unquote(leaf)
      candidates = lines.flatMap((l, i) => (l.includes(title.slice(0, 40)) ? [i + 1] : []))
      return candidates.length ? candidates.reduce((b, c) => (Math.abs(c - hint.line) < Math.abs(b - hint.line) ? c : b)) : null
    }
    const re = leaf === 'constructor' ? /\bconstructor\s*\(/ : leaf === 'default' ? /export\s+default\b/ : declRe(leaf)
    candidates = lines.flatMap((l, i) => (re.test(l) ? [i + 1] : []))
    if (!candidates.length) {
      const word = wordRe(leaf)
      candidates = lines.flatMap((l, i) => (word.test(l) ? [i + 1] : []))
    }
  }
  if (!candidates.length) return null
  return candidates.reduce((best, c) => (Math.abs(c - hint.line) < Math.abs(best - hint.line) ? c : best))
}

function grepFiles(root, word) {
  try {
    return git(root, ['grep', '-l', '-w', '-I', '--untracked', '-e', word, '--', '.', `:!${MEMOS_DIR}`], { quiet: true })
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

function grepLines(root, word, limit = 5) {
  try {
    return git(root, ['grep', '-n', '-w', '-I', '--untracked', '-e', word, '--', '.', `:!${MEMOS_DIR}`], { quiet: true })
      .split('\n')
      .filter(Boolean)
      .slice(0, limit)
      .map((l) => (l.length > 140 ? `${l.slice(0, 137)}...` : l))
  } catch {
    return []
  }
}

function grepFixed(root, text, limit = 5) {
  try {
    return git(root, ['grep', '-n', '-F', '-I', '--untracked', '-e', text.slice(0, 60), '--', '.', `:!${MEMOS_DIR}`], {
      quiet: true,
    })
      .split('\n')
      .filter(Boolean)
      .slice(0, limit)
  } catch {
    return []
  }
}

function renameTargets(root, source) {
  const renames = new Map()
  const collect = (out) => {
    for (const line of out.split('\n')) {
      const m = line.match(/^R\d*\t(.+?)\t(.+)$/)
      if (m) renames.set(m[1], m[2])
    }
  }
  try {
    collect(git(root, ['diff', '-M', '--name-status', 'HEAD'], { quiet: true }))
  } catch {}
  try {
    collect(git(root, ['log', '-M', '--diff-filter=R', '--name-status', '--format=', '-n', '5000'], { quiet: true }))
  } catch {}
  let current = source
  const seen = new Set()
  while (renames.has(current) && !seen.has(current)) {
    seen.add(current)
    current = renames.get(current)
  }
  return current !== source && existsSync(join(root, current)) ? current : null
}

function anchorCandidates(root, anchors) {
  const leaves = [
    ...new Set(anchors.map((a) => segmentsOf(a).at(-1)).filter((l) => l && l !== 'default' && !isQuoted(l))),
  ]
  const score = new Map()
  for (const leaf of leaves) for (const file of grepFiles(root, leaf)) score.set(file, (score.get(file) ?? 0) + 1)
  return {
    total: leaves.length,
    ranked: [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
  }
}

function newComments(root, config) {
  const inScope = new Set(sourceFiles(root, config))
  let changed = []
  try {
    changed = git(root, ['diff', '--name-only', 'HEAD'], { quiet: true }).split('\n')
  } catch {
    changed = trackedFiles(root)
  }
  try {
    changed.push(...git(root, ['ls-files', '--others', '--exclude-standard'], { quiet: true }).split('\n'))
  } catch {}
  const found = []
  for (const path of new Set(changed.filter((p) => inScope.has(p)))) {
    const current = scanFile(root, path, readFileSync(join(root, path), 'utf8'), config).filter(
      (e) => !e.keep && !e.decoration,
    )
    if (!current.length) continue
    let before = ''
    try {
      before = git(root, ['show', `HEAD:${path}`], { quiet: true })
    } catch {}
    const previous = new Map()
    for (const e of before ? scanFile(root, path, before, config) : []) {
      if (e.keep || e.decoration) continue
      const t = commentText(e)
      previous.set(t, (previous.get(t) ?? 0) + 1)
    }
    for (const e of current) {
      const t = commentText(e)
      const n = previous.get(t) ?? 0
      if (n > 0) previous.set(t, n - 1)
      else found.push(`${path}:${e.line}  ${t.length > 90 ? `${t.slice(0, 87)}...` : t}`)
    }
  }
  return found
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    root: {},
    changed: { type: 'boolean' },
    fix: { type: 'boolean' },
    help: { type: 'boolean' },
  })
  if (args.help) {
    console.log(USAGE)
    return
  }
  const root = findRoot(args.root)
  const config = loadConfig(root)
  if (!config) {
    console.log(`not migrated: ${CONFIG_FILE} is missing. Run \`/memos apply\` to migrate this project.`)
    process.exitCode = 1
    return
  }

  const report = { orphaned: [], unresolved: [], misplaced: [], stale: [], moved: [], fixedHints: 0 }
  const memoFiles = trackedFiles(root).filter(
    (p) => p.startsWith(`${MEMOS_DIR}/`) && p.endsWith('.md') && existsSync(join(root, p)),
  )
  let memoCount = 0

  for (const memoPath of memoFiles) {
    const memo = parseMemo(readFileSync(join(root, memoPath), 'utf8'))
    if (!memo.source) continue
    memoCount++
    const anchors = memo.sections.map((s) => s.anchor).filter(Boolean)
    const sourceFile = join(root, memo.source)

    if (!existsSync(sourceFile)) {
      const renamed = renameTargets(root, memo.source)
      const { total, ranked } = anchorCandidates(root, anchors)
      const confident =
        renamed ??
        (total >= 2 && ranked.length && ranked[0][1] === total && (ranked.length === 1 || ranked[1][1] < total)
          ? ranked[0][0]
          : null)
      const target = confident && !existsSync(join(root, memoPathFor(confident))) ? confident : null
      if (args.fix && target) {
        memo.source = target
        const dest = join(root, memoPathFor(target))
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, serializeMemo(memo))
        rmSync(join(root, memoPath))
        report.moved.push(`${memoPath} -> ${memoPathFor(target)}${renamed ? ' (git rename)' : ' (all anchors match)'}`)
        continue
      }
      report.orphaned.push({
        memoPath,
        source: memo.source,
        renamed,
        candidates: ranked.map(([file, n]) => `${file} (${n}/${total} anchors)`),
      })
      continue
    }

    if (memoPathFor(memo.source) !== memoPath) report.misplaced.push(`${memoPath} (source: ${memo.source}, expected ${memoPathFor(memo.source)})`)

    const text = readFileSync(sourceFile, 'utf8')
    const lines = text.split('\n')
    let dirty = false
    for (const section of memo.sections) {
      if (section.anchor) {
        const missing = segmentsOf(section.anchor).filter((s) => !segmentFound(text, s))
        if (missing.length) {
          const leaf = unquote(missing.at(-1))
          report.unresolved.push({
            where: `${memoPath} › ${section.anchor}`,
            missing,
            candidates: isQuoted(missing.at(-1)) ? grepFixed(root, leaf) : grepLines(root, leaf),
          })
          continue
        }
      }
      for (const note of section.notes) {
        if (!note.hint) continue
        if (!section.anchor && !note.hint.near) continue
        const line = locate(lines, section.anchor, note.hint)
        if (line === null || line === note.hint.line) continue
        if (args.fix) {
          note.hint.line = line
          dirty = true
          report.fixedHints++
        } else report.stale.push(`${memoPath} › ${section.anchor ?? '(file)'}: L${note.hint.line} -> L${line}`)
      }
    }
    if (dirty) writeFileSync(join(root, memoPath), serializeMemo(memo))
  }

  const added = args.changed ? newComments(root, config) : []

  console.log(`checked ${memoCount} memos`)
  for (const m of report.moved) console.log(`moved     ${m}`)
  if (report.fixedHints) console.log(`fixed     ${report.fixedHints} line hints`)
  for (const o of report.orphaned) {
    console.log(`\norphaned  ${o.memoPath}: ${o.source} no longer exists`)
    if (o.renamed) console.log(`  git rename -> ${o.renamed}`)
    if (o.candidates.length) console.log(`  anchors found in:\n${o.candidates.map((c) => `    ${c}`).join('\n')}`)
    if (!o.renamed && !o.candidates.length) console.log('  no trace found: the code was probably deleted')
  }
  for (const u of report.unresolved) {
    console.log(`\nunresolved  ${u.where}: ${u.missing.map((m) => `\`${m}\``).join(', ')} not in source`)
    if (u.candidates.length) console.log(`  \`${u.missing.at(-1)}\` appears in:\n${u.candidates.map((c) => `    ${c}`).join('\n')}`)
    else console.log('  not found anywhere: renamed or deleted')
  }
  for (const m of report.misplaced) console.log(`\nmisplaced ${m}`)
  if (report.stale.length) {
    console.log(`\nstale line hints (${report.stale.length}, run with --fix):`)
    for (const s of report.stale.slice(0, 20)) console.log(`  ${s}`)
    if (report.stale.length > 20) console.log(`  ... ${report.stale.length - 20} more`)
  }
  if (added.length) {
    console.log(`\nnew comments in source (${added.length}): move them to memos or delete them`)
    for (const a of added) console.log(`  ${a}`)
  }
  const failing = report.orphaned.length + report.unresolved.length + report.misplaced.length + added.length
  console.log(failing ? `\n${failing} problems` : '\nok')
  if (failing) process.exitCode = 1
}

try {
  main()
} catch (e) {
  console.error(`memos verify: ${e.message}`)
  process.exitCode = 1
}
