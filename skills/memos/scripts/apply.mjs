#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addNote, emptyMemo, parseMemo, serializeMemo } from './lib/memo.mjs'
import {
  CONFIG_FILE,
  DEFAULT_CONFIG,
  findRoot,
  isClean,
  loadConfig,
  memoPathFor,
  parseArgs,
  saveConfig,
  sourceFiles,
} from './lib/project.mjs'
import { anchorOf, isPython, noteOf, sameJsCode, scanFile, unsafePythonFiles, withIndex } from './lib/scan.mjs'
import { stripComments } from './lib/strip.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SNIPPET = join(HERE, '..', 'templates', 'agents-snippet.md')
const START = '<!-- memos:start -->'
const END = '<!-- memos:end -->'

const USAGE = `usage: apply.mjs <plan|run> [options]

  plan              dry run: what would move, what stays, what could not be anchored
  run               migrate: write memos, strip comments, write ${CONFIG_FILE}, install the AGENTS.md rules

  --root <dir>      project root (default: git top level of cwd)
  --only <path>     limit to a file or directory (repeatable)
  --exclude <glob>  add an exclude glob, saved to the config on run (repeatable)
  --show <file>     plan only: print the memo and the source diff for one file
  --force           run even if the git working tree is not clean`

function plan(root, config, only) {
  const files = sourceFiles(root, config, only)
  const results = []
  const stats = { scanned: files.length, kept: {}, moved: 0, lines: 0, decoration: 0, exact: 0, near: 0, file: 0 }
  for (const path of files) {
    const text = readFileSync(join(root, path), 'utf8')
    const entries = scanFile(root, path, text, config)
    for (const e of entries) if (e.keep) stats.kept[e.keep] = (stats.kept[e.keep] ?? 0) + 1
    const move = entries.filter((e) => !e.keep)
    if (move.length === 0) continue
    const memoPath = memoPathFor(path)
    const memoFile = join(root, memoPath)
    const memo = existsSync(memoFile) ? parseMemo(readFileSync(memoFile, 'utf8')) : emptyMemo(path)
    const stripped = withIndex(stripComments(text, move))
    const unanchored = []
    for (const e of move) {
      stats.moved++
      stats.lines += e.endLine - e.line + 1
      if (e.decoration) {
        stats.decoration++
        continue
      }
      if (e.anchor.length === 0) {
        stats.file++
        if (e.near) unanchored.push(e)
      } else if (e.exact) stats.exact++
      else stats.near++
      addNote(memo, anchorOf(e), noteOf(e, stripped))
    }
    results.push({
      path,
      memoPath,
      before: text,
      after: stripped.text,
      memo,
      count: move.length,
      unanchored,
    })
  }
  return { results, stats }
}

function printPlan({ results, stats }) {
  const kept = Object.entries(stats.kept)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ')
  console.log(`scanned        ${stats.scanned} files`)
  console.log(`to migrate     ${stats.moved} comments (${stats.lines} lines) in ${results.length} files`)
  console.log(`  anchored     ${stats.exact} on a symbol, ${stats.near} inside a symbol (with near:)`)
  console.log(`  file-level   ${stats.file}`)
  console.log(`  dropped      ${stats.decoration} decoration-only (rulers, empty)`)
  console.log(`kept in code   ${kept || 'none'}`)
  const top = [...results].sort((a, b) => b.count - a.count).slice(0, 15)
  if (top.length) {
    console.log('\nmost comments:')
    for (const r of top) console.log(`  ${String(r.count).padStart(5)}  ${r.path}`)
  }
  const unanchored = results.flatMap((r) => r.unanchored.map((e) => `${r.path}:${e.line}  ${e.near}`))
  if (unanchored.length) {
    console.log(`\nfile-level notes that are not file headers (${unanchored.length}):`)
    for (const line of unanchored.slice(0, 30)) console.log(`  ${line}`)
    if (unanchored.length > 30) console.log(`  ... ${unanchored.length - 30} more`)
  }
}

function show(root, result) {
  console.log(`=== ${result.memoPath}\n`)
  console.log(serializeMemo(result.memo))
  const dir = mkdtempSync(join(tmpdir(), 'memos-'))
  try {
    writeFileSync(join(dir, 'before'), result.before)
    writeFileSync(join(dir, 'after'), result.after)
    let diff = ''
    try {
      execFileSync('git', ['diff', '--no-index', '--no-color', 'before', 'after'], { cwd: dir, encoding: 'utf8' })
    } catch (e) {
      diff = e.stdout
    }
    console.log(`=== ${result.path}\n`)
    console.log(diff.split('\n').slice(4).join('\n'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function installSnippet(root) {
  const snippet = readFileSync(SNIPPET, 'utf8').trim()
  const target = ['AGENTS.md', 'CLAUDE.md'].map((f) => join(root, f)).find(existsSync) ?? join(root, 'AGENTS.md')
  const current = existsSync(target) ? readFileSync(target, 'utf8') : ''
  const a = current.indexOf(START)
  const b = current.indexOf(END)
  const next =
    a >= 0 && b > a
      ? current.slice(0, a) + snippet + current.slice(b + END.length)
      : `${current.replace(/\s*$/, '')}${current.trim() ? '\n\n' : ''}${snippet}\n`
  writeFileSync(target, next)
  return target
}

function run(root, config, only) {
  const planned = plan(root, config, only)
  const unsafe = new Set()
  for (const r of planned.results) {
    if (!isPython(r.path) && !sameJsCode(root, r.path, r.before, r.after)) unsafe.add(r.path)
  }
  const py = planned.results.filter((r) => isPython(r.path))
  for (const path of unsafePythonFiles(py.map(({ path, before, after }) => ({ path, before, after })))) unsafe.add(path)

  let written = 0
  for (const r of planned.results) {
    if (unsafe.has(r.path)) continue
    const memoFile = join(root, r.memoPath)
    mkdirSync(dirname(memoFile), { recursive: true })
    writeFileSync(memoFile, serializeMemo(r.memo))
    writeFileSync(join(root, r.path), r.after)
    written++
  }
  saveConfig(root, config)
  const agents = installSnippet(root)

  printPlan(planned)
  console.log(`\nmigrated ${written} files, memos in .agents/memos/, config ${CONFIG_FILE}`)
  console.log(`rules installed in ${agents.slice(root.length + 1)}`)
  if (unsafe.size) {
    console.log(`\nskipped ${unsafe.size} files: stripping would change code tokens (left untouched):`)
    for (const path of unsafe) console.log(`  ${path}`)
    process.exitCode = 2
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    root: {},
    only: { multiple: true },
    exclude: { multiple: true },
    show: {},
    force: { type: 'boolean' },
    help: { type: 'boolean' },
  })
  const command = args._[0]
  if (args.help || !['plan', 'run'].includes(command)) {
    console.log(USAGE)
    process.exitCode = args.help ? 0 : 1
    return
  }
  const root = findRoot(args.root)
  const config = loadConfig(root) ?? structuredClone(DEFAULT_CONFIG)
  config.exclude = [...new Set([...config.exclude, ...args.exclude])]

  if (command === 'plan') {
    const only = args.show ? [args.show] : args.only
    const planned = plan(root, config, only)
    if (args.show) {
      const result = planned.results[0]
      if (!result) console.log(`nothing to migrate in ${args.show}`)
      else show(root, result)
      return
    }
    printPlan(planned)
    return
  }
  if (!args.force && !isClean(root)) {
    console.error('the git working tree is not clean; commit or stash first (or pass --force)')
    process.exitCode = 1
    return
  }
  run(root, config, args.only)
}

try {
  main()
} catch (e) {
  console.error(`memos apply: ${e.message}`)
  process.exitCode = 1
}
