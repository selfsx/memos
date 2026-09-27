import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { trackedFiles } from './project.mjs'

let cached

function tryLoad(dir) {
  try {
    return createRequire(join(dir, 'noop.js'))('typescript')
  } catch {
    return null
  }
}

export function loadTypeScript(root) {
  if (cached !== undefined) return cached
  const candidates = [root]
  const manifests = trackedFiles(root)
    .filter((path) => path.endsWith('package.json') && !path.includes('node_modules/'))
    .map((path) => join(root, dirname(path)))
    .sort((a, b) => a.length - b.length)
  candidates.push(...manifests)
  try {
    candidates.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim())
  } catch {}
  candidates.push(dirname(new URL(import.meta.url).pathname))
  for (const dir of candidates) {
    const ts = tryLoad(dir)
    if (ts) return (cached = ts)
  }
  return (cached = null)
}

export function requireTypeScript(root) {
  const ts = loadTypeScript(root)
  if (!ts) {
    throw new Error(
      'the `typescript` package is required to parse JS/TS files and was not found in the project, ' +
        'its workspaces or the global npm root. Install it (`npm i -D typescript`) or exclude JS/TS files.',
    )
  }
  return ts
}
