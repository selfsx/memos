import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL_DIR = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..'))

export const MEMOS_DIR = '.agents/memos'
export const CONFIG_FILE = `${MEMOS_DIR}/memos.json`

export const DEFAULT_CONFIG = {
  version: 1,
  extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py'],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/vendor/**',
    '**/*.min.js',
    '.agents/**',
  ],
  keep: [],
}

export function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', options.quiet ? 'ignore' : 'pipe'],
  })
}

export function findRoot(start = process.cwd()) {
  try {
    return git(resolve(start), ['rev-parse', '--show-toplevel'], { quiet: true }).trim()
  } catch {
    throw new Error(`not a git repository: ${start}`)
  }
}

export function parseArgs(argv, spec) {
  const out = { _: [] }
  for (const [name, def] of Object.entries(spec)) out[name] = def.multiple ? [] : def.default
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      out._.push(arg)
      continue
    }
    const [key, inline] = arg.slice(2).split(/=(.*)/s, 2)
    const def = spec[key]
    if (!def) throw new Error(`unknown option --${key}`)
    if (def.type === 'boolean') {
      out[key] = true
      continue
    }
    const value = inline ?? argv[++i]
    if (value === undefined) throw new Error(`--${key} needs a value`)
    if (def.multiple) out[key].push(value)
    else out[key] = value
  }
  return out
}

export function loadConfig(root) {
  const file = join(root, CONFIG_FILE)
  if (!existsSync(file)) return null
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  return { ...DEFAULT_CONFIG, ...raw }
}

export function saveConfig(root, config) {
  const file = join(root, CONFIG_FILE)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
}

export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/'
        re += slash ? '(?:.*/)?' : '.*'
        i += slash ? 2 : 1
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      const close = glob.indexOf('}', i)
      const options = glob.slice(i + 1, close).split(',')
      re += `(?:${options.map((o) => globToRegExp(o).source.slice(1, -1)).join('|')})`
      i = close
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

export function makeMatcher(globs) {
  const res = globs.map(globToRegExp)
  return (path) => res.some((re) => re.test(path))
}

export function trackedFiles(root) {
  return git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean)
}

export function sourceFiles(root, config, only = []) {
  const excluded = makeMatcher(config.exclude)
  const exts = new Set(config.extensions)
  return trackedFiles(root).filter((path) => {
    if (excluded(path)) return false
    if (only.length && !only.some((prefix) => path === prefix || path.startsWith(prefix.replace(/\/?$/, '/')))) return false
    const dot = path.lastIndexOf('.')
    if (dot <= path.lastIndexOf('/') || !exts.has(path.slice(dot))) return false
    const full = join(root, path)
    return existsSync(full) && !realpathSync(full).startsWith(`${SKILL_DIR}/`)
  })
}

export function memoPathFor(source) {
  return `${MEMOS_DIR}/${source}.md`
}

export function isClean(root) {
  return git(root, ['status', '--porcelain']).trim() === ''
}
